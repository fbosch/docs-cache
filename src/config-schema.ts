import { z } from "zod";

export const TargetModeSchema = z.enum(["symlink", "copy"]);
export const CacheModeSchema = z.enum(["materialize", "sparse"]);
export const IntegritySchema = z.object({
	type: z.enum(["commit", "manifest"]),
	value: z.string().nullable(),
});

export const DefaultsSchema = z.object({
	ref: z.string().min(1),
	mode: CacheModeSchema,
	include: z.array(z.string().min(1)).min(1),
	targetMode: TargetModeSchema.optional(),
	depth: z.number().min(1),
	required: z.boolean(),
	maxBytes: z.number().min(1),
	allowHosts: z.array(z.string().min(1)).min(1),
});

export const SourceSchema = z.object({
	id: z.string().min(1),
	repo: z.string().min(1),
	targetDir: z.string().min(1).optional(),
	targetMode: TargetModeSchema.optional(),
	ref: z.string().min(1).optional(),
	mode: CacheModeSchema.optional(),
	depth: z.number().min(1).optional(),
	include: z.array(z.string().min(1)).optional(),
	exclude: z.array(z.string().min(1)).optional(),
	required: z.boolean().optional(),
	maxBytes: z.number().min(1).optional(),
	integrity: IntegritySchema.optional(),
});

export const ConfigSchema = z
	.object({
		$schema: z.string().min(1).optional(),
		cacheDir: z.string().min(1).optional(),
		targetMode: TargetModeSchema.optional(),
		defaults: DefaultsSchema.partial().optional(),
		sources: z.array(SourceSchema),
	})
	.strict();
