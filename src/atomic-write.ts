import { chmod, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const writeFileAtomically = async (
	filePath: string,
	data: string,
	options?: { mode?: number },
) => {
	let mode = options?.mode ?? 0o644;
	try {
		mode = (await stat(filePath)).mode;
	} catch {
		// Use the caller's default mode when creating a new file.
	}
	await mkdir(path.dirname(filePath), { recursive: true });
	const tempPath = path.join(
		path.dirname(filePath),
		`.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
	);
	try {
		await writeFile(tempPath, data, { encoding: "utf8", mode });
		await chmod(tempPath, mode);
		await rename(tempPath, filePath);
	} finally {
		await rm(tempPath, { force: true });
	}
};
