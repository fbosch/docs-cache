import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { DocsCacheOpenCodeLock } from "#cache/lock";
import { writeFileAtomically } from "#core/atomic-write";
import { isRecord } from "#core/is-record";

const stateDirectory = () =>
	path.join(
		process.env.XDG_STATE_HOME ?? path.join(homedir(), ".local", "state"),
		"docs-cache",
		"opencode",
	);

const statePathFor = (configPath: string) => {
	const hash = createHash("sha256")
		.update(path.resolve(configPath))
		.digest("hex");
	return path.join(stateDirectory(), `${hash}.json`);
};

const validateOwnership = (value: unknown): DocsCacheOpenCodeLock => {
	if (!isRecord(value) || value.version !== 1) {
		throw new Error("Invalid local OpenCode ownership state.");
	}
	if (typeof value.configPath !== "string" || value.configPath.length === 0) {
		throw new Error("Invalid local OpenCode ownership configPath.");
	}
	if (
		!Array.isArray(value.aliases) ||
		!value.aliases.every(
			(alias): alias is string => typeof alias === "string" && alias.length > 0,
		)
	) {
		throw new Error("Invalid local OpenCode ownership aliases.");
	}
	return { configPath: value.configPath, aliases: value.aliases };
};

export const readOpenCodeOwnership = async (configPath: string) => {
	try {
		const raw = await readFile(statePathFor(configPath), "utf8");
		return validateOwnership(JSON.parse(raw));
	} catch (error) {
		const code = isRecord(error) ? error.code : undefined;
		if (code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
};

export const writeOpenCodeOwnership = async (
	configPath: string,
	ownership: DocsCacheOpenCodeLock,
) => {
	const data = `${JSON.stringify({ version: 1, ...ownership }, null, 2)}\n`;
	await writeFileAtomically(statePathFor(configPath), data, { mode: 0o600 });
};

export const restoreOpenCodeOwnership = async (
	configPath: string,
	ownership: DocsCacheOpenCodeLock | undefined,
) => {
	if (ownership) {
		await writeOpenCodeOwnership(configPath, ownership);
		return;
	}
	await rm(statePathFor(configPath), { force: true });
};
