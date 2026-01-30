import { cp, mkdir, rm, symlink } from "node:fs/promises";
import path from "node:path";

type TargetParams = {
	sourceDir: string;
	targetDir: string;
	mode?: "symlink" | "copy";
};

const removeTarget = async (targetDir: string) => {
	await rm(targetDir, { recursive: true, force: true });
};

export const applyTargetDir = async (params: TargetParams) => {
	const parentDir = path.dirname(params.targetDir);
	await mkdir(parentDir, { recursive: true });
	await removeTarget(params.targetDir);

	const defaultMode = process.platform === "win32" ? "copy" : "symlink";
	const mode = params.mode ?? defaultMode;
	if (mode === "copy") {
		await cp(params.sourceDir, params.targetDir, { recursive: true });
		return;
	}

	const type = process.platform === "win32" ? "junction" : "dir";
	await symlink(params.sourceDir, params.targetDir, type);
};
