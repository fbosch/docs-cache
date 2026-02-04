import { writeFile } from "node:fs/promises";
import { createJiti } from "jiti";
import { toJSONSchema } from "zod";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const schemaModule = await jiti.import("../src/config/schema.ts");

const schema = toJSONSchema(schemaModule.ConfigSchema, {
	name: "DocsCacheConfig",
});

const outputPath = new URL("../docs.config.schema.json", import.meta.url);
await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
