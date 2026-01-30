export type CacheMode = "materialize" | "sparse";

export type IntegrityType = "commit" | "manifest";

export interface DocsCacheIntegrity {
	type: IntegrityType;
	value: string | null;
}

export interface DocsCacheDefaults {
	ref: string;
	mode: CacheMode;
	depth: number;
	required: boolean;
	maxBytes: number;
	allowHosts: string[];
}

export interface DocsCacheSource {
	id: string;
	repo: string;
	ref?: string;
	mode?: CacheMode;
	depth?: number;
	include?: string[];
	exclude?: string[];
	required?: boolean;
	maxBytes?: number;
	integrity?: DocsCacheIntegrity;
}

export interface DocsCacheConfig {
	version: 1;
	cacheDir: string;
	defaults: DocsCacheDefaults;
	sources: DocsCacheSource[];
}

export interface DocsCacheLockSource {
	repo: string;
	ref: string;
	resolvedCommit: string;
	bytes: number;
	fileCount: number;
	manifestSha256: string;
	updatedAt: string;
}

export interface DocsCacheLock {
	version: 1;
	generatedAt: string;
	toolVersion: string;
	sources: Record<string, DocsCacheLockSource>;
}

export const CLI_NAME = "docs";
export const CONFIG_FILENAME = "docs.config.json";
export const DEFAULT_CACHE_DIR = ".docs";
export const LOCK_FILENAME = "docs.lock";
