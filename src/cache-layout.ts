import { mkdir } from "node:fs/promises";

import { getCacheLayout } from "./paths";

export const ensureCacheLayout = async (
	cacheDir: string,
	sourceIds: string[],
) => {
	const base = getCacheLayout(cacheDir, "tmp");
	await mkdir(base.cacheDir, { recursive: true });

	await Promise.all(
		sourceIds.map(async (sourceId) => {
			const layout = getCacheLayout(cacheDir, sourceId);
			await mkdir(layout.sourceDir, { recursive: true });
		}),
	);
};
