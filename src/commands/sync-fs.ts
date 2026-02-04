import { access } from "node:fs/promises";
import path from "node:path";
import { MANIFEST_FILENAME } from "#cache/manifest";

export const exists = async (target: string) => {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
};

export const hasDocs = async (cacheDir: string, sourceId: string) => {
	const sourceDir = path.join(cacheDir, ".docs", sourceId);
	if (!(await exists(sourceDir))) {
		return false;
	}
	return await exists(path.join(sourceDir, MANIFEST_FILENAME));
};
