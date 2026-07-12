import { access, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { applyEdits, modify, type ParseError, parse } from "jsonc-parser";
import type { DocsCacheOpenCodeLock } from "#cache/lock";
import type { DocsCacheOpenCode, DocsCacheSource } from "#config";
import { writeFileAtomically } from "#core/atomic-write";
import { isRecord } from "#core/is-record";

type Reference = {
	path: string;
	description: string;
};

type OpenCodeDocument = {
	references: Record<string, unknown>;
	raw: string;
};

export type OpenCodeReferencePlan = {
	drift: string[];
	nextState: DocsCacheOpenCodeLock | null | undefined;
	apply: () => Promise<void>;
	rollback: () => Promise<void>;
};

type FileChange = {
	filePath: string;
	raw: string;
	next: string;
	drift: string[];
};

const exists = async (filePath: string) => {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
};

const parseDocument = async (filePath: string): Promise<OpenCodeDocument> => {
	const raw = await readFile(filePath, "utf8");
	const errors: ParseError[] = [];
	const value = parse(raw, errors, {
		allowTrailingComma: true,
		disallowComments: false,
	});
	if (errors.length > 0) {
		throw new Error(`Invalid JSONC in OpenCode config at ${filePath}.`);
	}
	if (!isRecord(value)) {
		throw new Error(`OpenCode config at ${filePath} must be an object.`);
	}
	const references = value.references;
	if (references !== undefined && !isRecord(references)) {
		throw new Error(`OpenCode references in ${filePath} must be an object.`);
	}
	return { references: references ?? {}, raw };
};

const getRepositoryLabel = (repo: string) => {
	const sshMatch = repo.match(/^[^@]+@[^:]+:(.+)$/);
	const value = sshMatch?.[1] ?? repo.replace(/^https?:\/\/[^/]+\//, "");
	return value.replace(/\.git$/i, "").replace(/^\/+/, "");
};

const buildReference = (
	source: DocsCacheSource,
	cacheDir: string,
): Reference => ({
	path: path.resolve(cacheDir, source.id),
	description: `Use for documentation from ${getRepositoryLabel(source.repo)}.`,
});

const formattingOptionsFor = (raw: string) => {
	const indentation = raw.match(/\n([\t ]+)"/)?.[1] ?? "\t";
	return {
		insertSpaces: !indentation.includes("\t"),
		tabSize: indentation.length,
		eol: raw.includes("\r\n") ? "\r\n" : "\n",
	};
};

const updateReferences = (params: {
	raw: string;
	desired: Map<string, Reference>;
	stale: Set<string>;
}) => {
	let next = params.raw;
	const formattingOptions = formattingOptionsFor(next);
	for (const [alias, reference] of params.desired) {
		next = applyEdits(
			next,
			modify(next, ["references", alias], reference, { formattingOptions }),
		);
	}
	for (const alias of params.stale) {
		next = applyEdits(
			next,
			modify(next, ["references", alias], undefined, { formattingOptions }),
		);
	}
	return next;
};

const findDrift = (params: {
	references: Record<string, unknown>;
	desired: Map<string, Reference>;
	stale: Set<string>;
}) => {
	const drift: string[] = [];
	for (const [alias, reference] of params.desired) {
		if (
			!Object.hasOwn(params.references, alias) ||
			JSON.stringify(params.references[alias]) !== JSON.stringify(reference)
		) {
			drift.push(alias);
		}
	}
	for (const alias of params.stale) {
		if (Object.hasOwn(params.references, alias)) {
			drift.push(alias);
		}
	}
	return drift;
};

const assertNoUserAliasCollisions = (
	references: Record<string, unknown>,
	desired: Map<string, Reference>,
	managed: Set<string>,
	configPath: string,
) => {
	const collisions = Array.from(desired.keys()).filter(
		(alias) => Object.hasOwn(references, alias) && !managed.has(alias),
	);
	if (collisions.length > 0) {
		throw new Error(
			`OpenCode reference alias collision in ${configPath}: ${collisions.join(", ")}. Rename the docs-cache source or remove the user-owned reference.`,
		);
	}
};

const noOpPlan = (
	nextState: DocsCacheOpenCodeLock | null | undefined,
): OpenCodeReferencePlan => ({
	drift: [],
	nextState,
	apply: async () => undefined,
	rollback: async () => undefined,
});

const createPlan = (
	changes: FileChange[],
	nextState: DocsCacheOpenCodeLock | null,
): OpenCodeReferencePlan => {
	const changed = changes.filter((change) => change.next !== change.raw);
	const drift = changes.flatMap((change) => change.drift);
	return {
		drift,
		nextState,
		apply: async () => {
			const written: FileChange[] = [];
			try {
				for (const change of changed) {
					await writeFileAtomically(change.filePath, change.next);
					written.push(change);
				}
			} catch (error) {
				const rollbackFailures: unknown[] = [];
				for (const change of written.reverse()) {
					try {
						await writeFileAtomically(change.filePath, change.raw);
					} catch (rollbackError) {
						rollbackFailures.push(rollbackError);
					}
				}
				if (rollbackFailures.length > 0) {
					throw new AggregateError(
						[error, ...rollbackFailures],
						"Failed to apply OpenCode references and roll back cleanly.",
						{ cause: error },
					);
				}
				throw error;
			}
		},
		rollback: async () => {
			for (const change of [...changed].reverse()) {
				await writeFileAtomically(change.filePath, change.raw);
			}
		},
	};
};

const buildFileChange = (params: {
	configPath: string;
	document: OpenCodeDocument;
	desired: Map<string, Reference>;
	stale: Set<string>;
}) => ({
	filePath: params.configPath,
	raw: params.document.raw,
	next: updateReferences({
		raw: params.document.raw,
		desired: params.desired,
		stale: params.stale,
	}),
	drift: findDrift({
		references: params.document.references,
		desired: params.desired,
		stale: params.stale,
	}),
});

export const planOpenCodeReferences = async (params: {
	opencode: DocsCacheOpenCode | undefined;
	ownership: DocsCacheOpenCodeLock | undefined;
	sources: DocsCacheSource[];
	cacheDir: string;
}): Promise<OpenCodeReferencePlan> => {
	if (params.opencode === undefined) {
		return noOpPlan(undefined);
	}
	if (params.opencode === false) {
		return noOpPlan(undefined);
	}

	const configPath = path.resolve(params.opencode.configPath);
	if (!(await exists(configPath))) {
		throw new Error(`Configured OpenCode config not found at ${configPath}.`);
	}
	const document = await parseDocument(configPath);
	const writePath = await realpath(configPath);
	const desired = new Map(
		params.sources.map((source) => [
			source.id,
			buildReference(source, params.cacheDir),
		]),
	);
	const managed = new Set(
		params.ownership?.configPath === configPath ? params.ownership.aliases : [],
	);
	assertNoUserAliasCollisions(
		document.references,
		desired,
		managed,
		configPath,
	);
	const stale = new Set(
		Array.from(managed).filter((alias) => !desired.has(alias)),
	);
	const changes = [
		buildFileChange({
			configPath: writePath,
			document,
			desired,
			stale,
		}),
	];
	if (
		params.ownership?.configPath &&
		params.ownership.configPath !== configPath &&
		(await exists(params.ownership.configPath))
	) {
		const previousDocument = await parseDocument(params.ownership.configPath);
		const previousWritePath = await realpath(params.ownership.configPath);
		changes.unshift(
			buildFileChange({
				configPath: previousWritePath,
				document: previousDocument,
				desired: new Map(),
				stale: new Set(params.ownership.aliases),
			}),
		);
	}
	return createPlan(changes, {
		configPath,
		aliases: Array.from(desired.keys()),
	});
};
