import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const readmePath = path.join(rootDir, "README.md");
const badgeLink = "https://github.com/fbosch/docs-cache";

const formatBytes = (value) => {
	const units = ["B", "kB", "MB", "GB", "TB"];
	let size = value;
	let index = 0;
	while (size >= 1024 && index < units.length - 1) {
		size /= 1024;
		index += 1;
	}
	const precision = index === 0 ? 0 : 1;
	return `${size.toFixed(precision)} ${units[index]}`;
};

const normalizeSizeText = (entry) => {
	const sizeValue = entry?.size ?? entry?.sizeBytes ?? entry?.bytes;
	if (typeof sizeValue === "number" && Number.isFinite(sizeValue)) {
		return formatBytes(sizeValue);
	}
	if (typeof sizeValue === "string" && sizeValue.trim().length > 0) {
		return sizeValue.trim();
	}
	if (typeof entry?.size === "object" && entry.size) {
		const value = entry.size;
		if (typeof value.raw === "number") {
			return formatBytes(value.raw);
		}
		if (typeof value.value === "number" && typeof value.unit === "string") {
			return `${value.value} ${value.unit}`;
		}
	}
	return "unknown";
};

const runSizeLimit = async () => {
	let stdout = "";
	let exitCode = 0;
	try {
		const result = await execFileAsync(
			"pnpm",
			["exec", "size-limit", "--json"],
			{ cwd: rootDir, maxBuffer: 1024 * 1024 },
		);
		stdout = result.stdout;
	} catch (error) {
		exitCode = typeof error?.code === "number" ? error.code : 1;
		stdout = typeof error?.stdout === "string" ? error.stdout : "";
		if (!stdout) {
			throw error;
		}
	}
	const trimmed = stdout.trim();
	if (!trimmed) {
		throw new Error("size-limit did not return JSON output.");
	}
	const parsed = JSON.parse(trimmed);
	return { results: Array.isArray(parsed) ? parsed : [parsed], exitCode };
};

const updateReadmeBadge = async (sizeText) => {
	const readme = await readFile(readmePath, "utf8");
	const encoded = encodeURIComponent(sizeText);
	const badgeUrl = `https://img.shields.io/badge/size-${encoded}-blue`;
	const badgeLine = `[![size](${badgeUrl})](${badgeLink})`;
	const lines = readme.split("\n");
	const badgeIndex = lines.findIndex((line) =>
		line.includes("img.shields.io/badge/size-"),
	);
	if (badgeIndex >= 0) {
		lines[badgeIndex] = badgeLine;
	} else {
		const npmIndex = lines.findIndex((line) =>
			line.includes("img.shields.io/npm/v/docs-cache"),
		);
		const insertAt = npmIndex >= 0 ? npmIndex + 1 : 2;
		lines.splice(insertAt, 0, badgeLine);
	}
	await writeFile(readmePath, `${lines.join("\n")}\n`, "utf8");
};

const main = async () => {
	const { results, exitCode } = await runSizeLimit();
	const firstEntry = results[0] ?? {};
	const sizeText = normalizeSizeText(firstEntry);
	await updateReadmeBadge(sizeText);
	if (exitCode !== 0) {
		process.exit(exitCode);
	}
};

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exit(1);
});
