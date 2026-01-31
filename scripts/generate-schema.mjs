import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { zodToJsonSchema } from "zod-to-json-schema";

const moduleUrl = new URL("../dist/config-schema.mjs", import.meta.url);
const modulePath = fileURLToPath(moduleUrl);
const schemaModule = await import(modulePath);

const schema = zodToJsonSchema(schemaModule.ConfigSchema, {
	name: "DocsCacheConfig",
});

const outputPath = new URL("../docs.config.schema.json", import.meta.url);
await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
