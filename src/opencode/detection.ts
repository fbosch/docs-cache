import { access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const exists = async (filePath: string) => {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
};

const configFilesIn = (directory: string) => [
	path.join(directory, "opencode.json"),
	path.join(directory, "opencode.jsonc"),
];

const findProjectRoot = async (startDir: string) => {
	let directory = path.resolve(startDir);
	while (true) {
		if (await exists(path.join(directory, ".git"))) {
			return directory;
		}
		const parent = path.dirname(directory);
		if (parent === directory) {
			return path.resolve(startDir);
		}
		directory = parent;
	}
};

const projectDirectories = (rootDir: string, startDir: string) => {
	const directories: string[] = [];
	let directory = path.resolve(startDir);
	while (true) {
		directories.push(directory);
		if (directory === rootDir) {
			return directories.reverse();
		}
		directory = path.dirname(directory);
	}
};

export const getOpenCodeConfigCandidates = async (startDir: string) => {
	const candidates = [
		...configFilesIn(
			path.join(
				process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"),
				"opencode",
			),
		),
	];
	if (process.env.OPENCODE_CONFIG) {
		candidates.push(path.resolve(process.env.OPENCODE_CONFIG));
	}
	if (!process.env.OPENCODE_DISABLE_PROJECT_CONFIG) {
		const rootDir = await findProjectRoot(startDir);
		const directories = projectDirectories(rootDir, path.resolve(startDir));
		for (const directory of directories) {
			candidates.push(...configFilesIn(directory));
		}
		for (const directory of [...directories].reverse()) {
			candidates.push(...configFilesIn(path.join(directory, ".opencode")));
		}
	}
	candidates.push(...configFilesIn(path.join(homedir(), ".opencode")));
	if (process.env.OPENCODE_CONFIG_DIR) {
		candidates.push(
			...configFilesIn(path.resolve(process.env.OPENCODE_CONFIG_DIR)),
		);
	}
	return candidates;
};

export const detectOpenCodeConfig = async (startDir: string) => {
	const candidates = await getOpenCodeConfigCandidates(startDir);
	let detected: string | null = null;
	for (const candidate of candidates) {
		if (await exists(candidate)) {
			detected = candidate;
		}
	}
	return detected;
};
