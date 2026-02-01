import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { toPosixPath } from "./paths";

const exists = async (target: string) => {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
};

const normalizeEntry = (value: string) => {
	const trimmed = value.trim();
	if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) {
		return "";
	}
	let normalized = trimmed.replace(/^\//, "");
	normalized = normalized.replace(/^\.\//, "");
	normalized = normalized.replace(/\/+$/, "");
	return toPosixPath(normalized);
};

const resolveGitignoreEntry = (rootDir: string, cacheDir: string) => {
	const resolved = path.isAbsolute(cacheDir)
		? path.resolve(cacheDir)
		: path.resolve(rootDir, cacheDir);
	const relative = path.relative(rootDir, resolved);
	const isOutside =
		relative === ".." ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative);
	if (isOutside) {
		return null;
	}
	return relative.length === 0 ? "." : relative;
};

export const getGitignoreStatus = async (rootDir: string, cacheDir: string) => {
	const gitignorePath = path.resolve(rootDir, ".gitignore");
	const entry = resolveGitignoreEntry(rootDir, cacheDir);
	if (!entry) {
		return { gitignorePath, entry: null, hasEntry: false };
	}
	const normalizedEntry = normalizeEntry(entry);
	if (!normalizedEntry) {
		return { gitignorePath, entry: null, hasEntry: false };
	}
	let contents = "";
	if (await exists(gitignorePath)) {
		contents = await readFile(gitignorePath, "utf8");
	}
	const lines = contents.split(/\r?\n/);
	const existing = new Set(
		lines.map((line) => normalizeEntry(line)).filter(Boolean),
	);
	return {
		gitignorePath,
		entry: `${normalizedEntry}/`,
		hasEntry: existing.has(normalizedEntry),
	};
};

export const ensureGitignoreEntry = async (
	rootDir: string,
	cacheDir: string,
) => {
	const status = await getGitignoreStatus(rootDir, cacheDir);
	if (!status.entry) {
		return { updated: false, gitignorePath: status.gitignorePath, entry: null };
	}
	if (status.hasEntry) {
		return {
			updated: false,
			gitignorePath: status.gitignorePath,
			entry: status.entry,
		};
	}
	let contents = "";
	if (await exists(status.gitignorePath)) {
		contents = await readFile(status.gitignorePath, "utf8");
	}
	const prefix = contents.length === 0 || contents.endsWith("\n") ? "" : "\n";
	const next = `${contents}${prefix}${status.entry}\n`;
	await writeFile(status.gitignorePath, next, "utf8");
	return {
		updated: true,
		gitignorePath: status.gitignorePath,
		entry: status.entry,
	};
};
