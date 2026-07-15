import { access, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { applyEdits, modify, type ParseError, parse } from "jsonc-parser";
import type { DocsCacheOpenCodeLock } from "#cache/lock";
import type { DocsCacheOpenCode, DocsCacheSource } from "#config";
import { writeFileAtomically } from "#core/atomic-write";
import { isRecord } from "#core/is-record";
import { detectOpenCodeConfig } from "#opencode/detection";

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
	ownershipState: DocsCacheOpenCodeLock | undefined;
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

const parseDocumentValue = (raw: string, filePath: string) => {
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
	return value;
};

const getDocumentReferences = (
	value: Record<string, unknown>,
	filePath: string,
) => {
	const references = value.references;
	if (references !== undefined && !isRecord(references)) {
		throw new Error(`OpenCode references in ${filePath} must be an object.`);
	}
	return references ?? {};
};

const parseDocument = async (filePath: string): Promise<OpenCodeDocument> => {
	const raw = await readFile(filePath, "utf8");
	const value = parseDocumentValue(raw, filePath);
	return { references: getDocumentReferences(value, filePath), raw };
};

const getRepositoryLabel = (repo: string) => {
	const sshMatch = repo.match(/^[^@]+@[^:]+:(.+)$/);
	const value = sshMatch?.[1] ?? repo.replace(/^https?:\/\/[^/]+\//, "");
	return value.replace(/\.git$/i, "").replace(/^\/+/, "");
};

const buildReference = (
	source: DocsCacheSource,
	cacheDir: string,
	configPath: string,
): Reference => ({
	path: path
		.relative(path.dirname(configPath), path.resolve(cacheDir, source.id))
		.split(path.sep)
		.join("/"),
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

const findDesiredDrift = (
	references: Record<string, unknown>,
	desired: Map<string, Reference>,
) => {
	const drift: string[] = [];
	for (const [alias, reference] of desired) {
		if (
			!Object.hasOwn(references, alias) ||
			JSON.stringify(references[alias]) !== JSON.stringify(reference)
		) {
			drift.push(alias);
		}
	}
	return drift;
};

const findStaleDrift = (
	references: Record<string, unknown>,
	stale: Set<string>,
) => {
	const drift: string[] = [];
	for (const alias of stale) {
		if (Object.hasOwn(references, alias)) {
			drift.push(alias);
		}
	}
	return drift;
};

const findDrift = (params: {
	references: Record<string, unknown>;
	desired: Map<string, Reference>;
	stale: Set<string>;
}) => [
	...findDesiredDrift(params.references, params.desired),
	...findStaleDrift(params.references, params.stale),
];

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
	ownershipState: undefined,
	apply: async () => undefined,
	rollback: async () => undefined,
});

const rollbackChanges = async (changes: FileChange[]) => {
	for (const change of [...changes].reverse()) {
		await writeFileAtomically(change.filePath, change.raw);
	}
};

const restoreAppliedChanges = async (changes: FileChange[]) => {
	const failures: unknown[] = [];
	for (const change of [...changes].reverse()) {
		try {
			await writeFileAtomically(change.filePath, change.raw);
		} catch (error) {
			failures.push(error);
		}
	}
	return failures;
};

const applyChanges = async (changes: FileChange[]) => {
	const written: FileChange[] = [];
	try {
		for (const change of changes) {
			await writeFileAtomically(change.filePath, change.next);
			written.push(change);
		}
	} catch (error) {
		const rollbackFailures = await restoreAppliedChanges(written);
		if (rollbackFailures.length > 0) {
			throw new AggregateError(
				[error, ...rollbackFailures],
				"Failed to apply OpenCode references and roll back cleanly.",
				{ cause: error },
			);
		}
		throw error;
	}
};

const createPlan = (
	changes: FileChange[],
	nextState: DocsCacheOpenCodeLock | null,
	ownershipState: DocsCacheOpenCodeLock,
): OpenCodeReferencePlan => {
	const changed = changes.filter((change) => change.next !== change.raw);
	const drift = changes.flatMap((change) => change.drift);
	return {
		drift,
		nextState,
		ownershipState,
		apply: async () => applyChanges(changed),
		rollback: async () => rollbackChanges(changed),
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

const resolveOpenCodeConfigPath = (
	configPath: string,
	opencodeConfigPath: string,
) => path.resolve(path.dirname(configPath), opencodeConfigPath);

export const getProjectOpenCodeConfigPath = (
	configPath: string,
	opencodeConfigPath: string,
) => {
	const relativePath = path.relative(
		path.dirname(configPath),
		opencodeConfigPath,
	);
	if (
		relativePath === "" ||
		relativePath.split(path.sep, 1)[0] === ".." ||
		path.isAbsolute(relativePath)
	) {
		return null;
	}
	return relativePath.split(path.sep).join("/");
};

const requireProjectOpenCodeConfigPath = (
	configPath: string,
	opencodeConfigPath: string,
) => {
	const projectConfigPath = getProjectOpenCodeConfigPath(
		configPath,
		opencodeConfigPath,
	);
	if (projectConfigPath) {
		return projectConfigPath;
	}
	throw new Error(
		`OpenCode config at ${opencodeConfigPath} must be within the docs-cache project.`,
	);
};

const getConfigPath = async (
	opencode: Exclude<DocsCacheOpenCode, false>,
	docsConfigPath: string,
) => {
	const configPath =
		opencode === true
			? await detectOpenCodeConfig(path.dirname(docsConfigPath))
			: resolveOpenCodeConfigPath(docsConfigPath, opencode.configPath);
	if (!configPath) {
		throw new Error(`Project OpenCode config not found for ${docsConfigPath}.`);
	}
	if (!(await exists(configPath))) {
		throw new Error(`Configured OpenCode config not found at ${configPath}.`);
	}
	return configPath;
};

const resolveExistingPath = async (filePath: string) => {
	if (!(await exists(filePath))) {
		return null;
	}
	return realpath(filePath);
};

const getManagedAliases = async (
	ownership: DocsCacheOpenCodeLock | undefined,
	configPath: string,
) => {
	if (!ownership) {
		return new Set<string>();
	}
	const ownershipPath = await resolveExistingPath(ownership.configPath);
	return new Set(ownershipPath === configPath ? ownership.aliases : []);
};

const getPreviousFileChange = async (
	ownership: DocsCacheOpenCodeLock | undefined,
	configPath: string,
) => {
	if (!ownership) {
		return null;
	}
	const previousWritePath = await resolveExistingPath(ownership.configPath);
	if (!previousWritePath || previousWritePath === configPath) {
		return null;
	}
	const document = await parseDocument(ownership.configPath);
	return buildFileChange({
		configPath: previousWritePath,
		document,
		desired: new Map(),
		stale: new Set(ownership.aliases),
	});
};

export const planOpenCodeReferences = async (params: {
	opencode: DocsCacheOpenCode | undefined;
	ownership: DocsCacheOpenCodeLock | undefined;
	sources: DocsCacheSource[];
	cacheDir: string;
	configPath: string;
}): Promise<OpenCodeReferencePlan> => {
	if (params.opencode === undefined) {
		return noOpPlan(undefined);
	}
	if (params.opencode === false) {
		return noOpPlan(undefined);
	}

	const configPath = await getConfigPath(params.opencode, params.configPath);
	const document = await parseDocument(configPath);
	const writePath = await realpath(configPath);
	const desired = new Map(
		params.sources.map((source) => [
			source.id,
			buildReference(source, params.cacheDir, configPath),
		]),
	);
	const managed = await getManagedAliases(params.ownership, writePath);
	assertNoUserAliasCollisions(
		document.references,
		desired,
		managed,
		configPath,
	);
	const stale = new Set(
		Array.from(managed).filter((alias) => !desired.has(alias)),
	);
	const currentChange = buildFileChange({
		configPath: writePath,
		document,
		desired,
		stale,
	});
	const previousChange = await getPreviousFileChange(
		params.ownership,
		writePath,
	);
	const changes = previousChange
		? [previousChange, currentChange]
		: [currentChange];
	const aliases = Array.from(desired.keys());
	const projectConfigPath = requireProjectOpenCodeConfigPath(
		params.configPath,
		configPath,
	);
	return createPlan(
		changes,
		{ configPath: projectConfigPath, aliases },
		{ configPath: writePath, aliases },
	);
};
