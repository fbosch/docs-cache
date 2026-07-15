import * as z from "zod";
import { assertSafeSourceId } from "#core/source-id";

export const TargetModeSchema = z.enum(["symlink", "copy"]);
export const CacheModeSchema = z.enum(["materialize"]);
export const TocFormatSchema = z.enum(["tree", "compressed"]);
const OpenCodeSchema = z.union([
	z.literal(true),
	z.literal(false),
	z
		.object({
			configPath: z.string().min(1),
		})
		.strict(),
]);
export const IntegritySchema = z
	.object({
		type: z.enum(["commit", "manifest"]),
		value: z.string().nullable(),
	})
	.strict();

const CommonOptionsSchema = z.object({
	ref: z.string().min(1),
	mode: CacheModeSchema,
	include: z.array(z.string().min(1)).min(1),
	exclude: z.array(z.string().min(1)).optional(),
	targetMode: TargetModeSchema.optional(),
	required: z.boolean(),
	maxBytes: z.number().min(1),
	maxFiles: z.number().min(1).optional(),
	ignoreHidden: z.boolean(),
	toc: z.union([z.boolean(), TocFormatSchema]).optional(),
	unwrapSingleRootDir: z.boolean().optional(),
});

export const DefaultsSchema = CommonOptionsSchema.extend({
	allowHosts: z.array(z.string().min(1)).min(1),
}).strict();

export const SourceSchema = CommonOptionsSchema.partial()
	.extend({
		id: z
			.string()
			.min(1)
			.superRefine((value, ctx) => {
				try {
					assertSafeSourceId(value, "id");
				} catch (error) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message:
							error instanceof Error ? error.message : "Invalid source id.",
					});
				}
			}),
		repo: z.string().min(1),
		targetDir: z.string().min(1).optional(),
		integrity: IntegritySchema.optional(),
	})
	.extend({
		include: z
			.array(z.string().min(1))
			.min(1, { message: "include must be a non-empty array" })
			.optional(),
	})
	.strict();

export const ResolvedSourceSchema = SourceSchema.extend(
	CommonOptionsSchema.shape,
).strict();

export const ConfigSchema = z
	.object({
		$schema: z.string().min(1).optional(),
		cacheDir: z.string().min(1).optional(),
		targetMode: TargetModeSchema.optional(),
		defaults: DefaultsSchema.partial().optional(),
		opencode: OpenCodeSchema.optional(),
		sources: z.array(SourceSchema),
	})
	.strict()
	.superRefine((value, ctx) => {
		const seen = new Set<string>();
		const duplicates = new Set<string>();
		value.sources.forEach((source) => {
			if (seen.has(source.id)) {
				duplicates.add(source.id);
			} else {
				seen.add(source.id);
			}
		});
		if (duplicates.size > 0) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["sources"],
				message: `Duplicate source IDs found: ${Array.from(duplicates).join(", ")}.`,
			});
		}
		if (value.opencode) {
			value.sources.forEach((source, index) => {
				if (/[/\s`,]/.test(source.id)) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						path: ["sources", index, "id"],
						message:
							"id must not contain slashes, whitespace, backticks, or commas when OpenCode integration is enabled.",
					});
				}
			});
		}
	});

export type DocsCacheDefaults = z.infer<typeof DefaultsSchema>;
export type DocsCacheSource = z.infer<typeof SourceSchema>;
export type DocsCacheResolvedSource = z.infer<typeof ResolvedSourceSchema>;
export type DocsCacheConfig = z.infer<typeof ConfigSchema>;
export type DocsCacheIntegrity = z.infer<typeof IntegritySchema>;
export type DocsCacheOpenCode = z.infer<typeof OpenCodeSchema>;
export type CacheMode = z.infer<typeof CacheModeSchema>;
export type TocFormat = z.infer<typeof TocFormatSchema>;
