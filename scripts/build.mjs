import { spawn } from "node:child_process";
import { readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const distDir = "dist";
const tscPath = fileURLToPath(
	new URL("../node_modules/typescript/bin/tsc", import.meta.url),
);

const run = (command, args) =>
	new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: "inherit" });
		child.once("error", reject);
		child.once("exit", (code) => {
			if (code === 0) {
				resolve();
				return;
			}

			reject(new Error(`${command} exited with code ${code}`));
		});
	});

const renameJavaScriptFiles = async (directory) => {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			await renameJavaScriptFiles(entryPath);
			continue;
		}
		if (path.extname(entry.name) === ".js") {
			await rename(entryPath, `${entryPath.slice(0, -3)}.mjs`);
		}
	}
};

await rm(distDir, { recursive: true, force: true });
await run(process.execPath, [tscPath, "-p", "tsconfig.build.json"]);
await renameJavaScriptFiles(path.join(distDir, "esm"));
await Promise.all([
	writeFile("dist/api.mjs", 'export * from "./esm/api.mjs";\n'),
	writeFile("dist/cli.mjs", 'export * from "./esm/cli/index.mjs";\n'),
	writeFile("dist/lock.mjs", 'export * from "./esm/cache/lock.mjs";\n'),
]);
