import { cp, mkdir, readdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { MANIFEST_FILENAME } from "#cache/manifest";
import { getErrnoCode } from "#core/errors";
import { DEFAULT_TOC_FILENAME } from "#core/paths";

type TargetDeps = {
	cp: typeof cp;
	mkdir: typeof mkdir;
	readdir: typeof readdir;
	rm: typeof rm;
	symlink: typeof symlink;
	stderr: NodeJS.WritableStream;
};

type TargetParams = {
	sourceDir: string;
	targetDir: string;
	mode?: "symlink" | "copy";
	explicitTargetMode?: boolean;
	unwrapSingleRootDir?: boolean;
	deps?: TargetDeps;
};

const removeTarget = async (targetDir: string, deps: TargetDeps) => {
	await deps.rm(targetDir, { recursive: true, force: true });
};

const resolveSourceDir = async (params: TargetParams, deps: TargetDeps) => {
	if (!params.unwrapSingleRootDir) {
		return params.sourceDir;
	}
	const entries = await deps.readdir(params.sourceDir, { withFileTypes: true });
	const metaFiles = new Set([MANIFEST_FILENAME, DEFAULT_TOC_FILENAME]);
	const nonMeta = entries.filter((entry) => {
		if (entry.isFile() && metaFiles.has(entry.name)) {
			return false;
		}
		return true;
	});
	const directories = nonMeta.filter((entry) => entry.isDirectory());
	const nonMetaFiles = nonMeta.filter((entry) => entry.isFile());
	if (directories.length !== 1 || nonMetaFiles.length > 0) {
		return params.sourceDir;
	}
	return path.join(params.sourceDir, directories[0].name);
};

export const applyTargetDir = async (params: TargetParams) => {
	const deps = params.deps ?? {
		cp,
		mkdir,
		readdir,
		rm,
		symlink,
		stderr: process.stderr,
	};
	const sourceDir = await resolveSourceDir(params, deps);
	const parentDir = path.dirname(params.targetDir);
	await deps.mkdir(parentDir, { recursive: true });
	await removeTarget(params.targetDir, deps);

	const defaultMode = process.platform === "win32" ? "copy" : "symlink";
	const mode = params.mode ?? defaultMode;
	if (mode === "copy") {
		await deps.cp(sourceDir, params.targetDir, { recursive: true });
		return;
	}

	const type = process.platform === "win32" ? "junction" : "dir";
	try {
		await deps.symlink(sourceDir, params.targetDir, type);
	} catch (error) {
		const code = getErrnoCode(error);
		const fallbackCodes = new Set(["EPERM", "EACCES", "ENOTSUP", "EINVAL"]);
		if (code && fallbackCodes.has(code)) {
			if (params.explicitTargetMode) {
				const message = error instanceof Error ? error.message : String(error);
				deps.stderr.write(
					`Warning: Failed to create symlink at ${params.targetDir}. Falling back to copy. ${message}\n`,
				);
			}
			await deps.cp(sourceDir, params.targetDir, { recursive: true });
			return;
		}
		throw error;
	}
};
