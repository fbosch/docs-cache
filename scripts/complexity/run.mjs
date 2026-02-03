import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import fg from "fast-glob";

const require = createRequire(import.meta.url);
const tscomplex = require("ts-complex");

const CONFIG_PATH = path.resolve(process.cwd(), "package.json");
const DEFAULTS = {
	maxCyclomatic: 20,
	minMaintainability: 60,
	top: 10,
};

const loadConfig = async () => {
	const raw = await readFile(CONFIG_PATH, "utf8");
	const pkg = JSON.parse(raw);
	return {
		...DEFAULTS,
		...(pkg.complexity ?? {}),
	};
};

const summarize = (value) =>
	value.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});

const formatNumber = (value) =>
	Number.isFinite(value) ? summarize(value) : "n/a";

const parseLocation = (name) => {
	if (!name || typeof name !== "string") return null;
	const trimmed = name.trim();
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
	try {
		const parsed = JSON.parse(trimmed);
		if (typeof parsed?.pos === "number" && typeof parsed?.end === "number") {
			return { pos: parsed.pos, end: parsed.end };
		}
	} catch {
		return null;
	}
	return null;
};

const lineOffsetsCache = new Map();

const getLineOffsets = async (filePath) => {
	if (lineOffsetsCache.has(filePath)) {
		return lineOffsetsCache.get(filePath);
	}
	const raw = await readFile(filePath, "utf8");
	const offsets = [0];
	for (let i = 0; i < raw.length; i += 1) {
		if (raw[i] === "\n") {
			offsets.push(i + 1);
		}
	}
	lineOffsetsCache.set(filePath, offsets);
	return offsets;
};

const offsetToLineColumn = async (filePath, offset) => {
	const offsets = await getLineOffsets(filePath);
	let low = 0;
	let high = offsets.length - 1;
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		if (offsets[mid] <= offset) {
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	const lineIndex = Math.max(0, high);
	const lineNumber = lineIndex + 1;
	const columnNumber = offset - offsets[lineIndex] + 1;
	return { line: lineNumber, column: columnNumber };
};

const formatLabel = async (name, filePath) => {
	const location = parseLocation(name);
	if (location && filePath) {
		const start = await offsetToLineColumn(filePath, location.pos);
		return `@${start.line}:${start.column}`;
	}
	return name || "<anonymous>";
};

const main = async () => {
	const config = await loadConfig();
	const files = await fg(["src/**/*.ts"], {
		ignore: ["**/*.d.ts"],
		absolute: true,
	});
	const metrics = [];
	const functions = [];

	for (const file of files) {
		const cyclomatic = tscomplex.calculateCyclomaticComplexity(file);
		const maintainability = tscomplex.calculateMaintainability(file);
		metrics.push({ file, maintainability });
		for (const [name, complexity] of Object.entries(cyclomatic)) {
			functions.push({ file, name, complexity });
		}
	}

	const maintainabilityValues = metrics
		.map((entry) => entry.maintainability.minMaintainability)
		.filter(
			(value) =>
				typeof value === "number" && Number.isFinite(value) && value >= 0,
		);
	const worstMaintainability = maintainabilityValues.length
		? Math.min(...maintainabilityValues)
		: null;
	const maxCyclomatic = functions.reduce(
		(max, entry) => Math.max(max, entry.complexity),
		0,
	);

	process.stdout.write("\nComplexity\n");
	process.stdout.write(`files=${files.length}\n`);
	process.stdout.write(
		`maxCyclomatic=${formatNumber(maxCyclomatic)} limit=${config.maxCyclomatic}\n`,
	);
	process.stdout.write(
		`minMaintainability=${formatNumber(worstMaintainability)} limit=${config.minMaintainability}\n`,
	);

	const sorted = functions
		.sort((left, right) => right.complexity - left.complexity)
		.slice(0, config.top);
	if (sorted.length > 0) {
		process.stdout.write("\nTop functions\n");
		process.stdout.write("Location                          CC   File\n");
		process.stdout.write(
			"-------------------------------- ---- -------------------------\n",
		);
		for (const entry of sorted) {
			const rel = path.relative(process.cwd(), entry.file);
			const name = (await formatLabel(entry.name, entry.file))
				.slice(0, 32)
				.padEnd(32);
			const cc = entry.complexity.toString().padStart(4);
			process.stdout.write(`${name} ${cc} ${rel}\n`);
		}
	}

	const failures = [];
	for (const entry of functions) {
		if (entry.complexity > config.maxCyclomatic) {
			const location = await formatLabel(entry.name, entry.file);
			const rel = path.relative(process.cwd(), entry.file);
			const label = location.startsWith("@")
				? `${rel}:${location.slice(1)}`
				: `${location} in ${rel}`;
			failures.push(`${label} (${entry.complexity})`);
		}
	}
	if (
		typeof worstMaintainability === "number" &&
		worstMaintainability < config.minMaintainability
	) {
		failures.push(
			`Maintainability below threshold: ${summarize(worstMaintainability)}`,
		);
	}

	if (failures.length > 0) {
		process.stderr.write("\nComplexity limits exceeded:\n");
		for (const failure of failures) {
			process.stderr.write(`- ${failure}\n`);
		}
		process.exitCode = 1;
	}
};

await main();
