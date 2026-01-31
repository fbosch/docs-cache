import { cp, mkdir, rm, symlink } from "node:fs/promises";
import path from "node:path";

type TargetDeps = {
	cp: typeof cp;
	mkdir: typeof mkdir;
	rm: typeof rm;
	symlink: typeof symlink;
	stderr: NodeJS.WritableStream;
};

type TargetParams = {
	sourceDir: string;
	targetDir: string;
	mode?: "symlink" | "copy";
	explicitTargetMode?: boolean;
	deps?: TargetDeps;
};

const removeTarget = async (targetDir: string, deps: TargetDeps) => {
	await deps.rm(targetDir, { recursive: true, force: true });
};

export const applyTargetDir = async (params: TargetParams) => {
	const deps = params.deps ?? {
		cp,
		mkdir,
		rm,
		symlink,
		stderr: process.stderr,
	};
	const parentDir = path.dirname(params.targetDir);
	await deps.mkdir(parentDir, { recursive: true });
	await removeTarget(params.targetDir, deps);

	const defaultMode = process.platform === "win32" ? "copy" : "symlink";
	const mode = params.mode ?? defaultMode;
	if (mode === "copy") {
		await deps.cp(params.sourceDir, params.targetDir, { recursive: true });
		return;
	}

	const type = process.platform === "win32" ? "junction" : "dir";
	try {
		await deps.symlink(params.sourceDir, params.targetDir, type);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		const fallbackCodes = new Set(["EPERM", "EACCES", "ENOTSUP", "EINVAL"]);
		if (code && fallbackCodes.has(code)) {
			if (params.explicitTargetMode) {
				const message = error instanceof Error ? error.message : String(error);
				deps.stderr.write(
					`Warning: Failed to create symlink at ${params.targetDir}. Falling back to copy. ${message}\n`,
				);
			}
			await deps.cp(params.sourceDir, params.targetDir, { recursive: true });
			return;
		}
		throw error;
	}
};
