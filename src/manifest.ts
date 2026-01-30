import { readFile } from "node:fs/promises";
import path from "node:path";

type ManifestEntry = {
	path: string;
	size: number;
};

export const readManifest = async (sourceDir: string) => {
	const manifestPath = path.join(sourceDir, "manifest.json");
	const raw = await readFile(manifestPath, "utf8");
	const data = JSON.parse(raw) as ManifestEntry[];
	return { manifestPath, entries: data };
};
