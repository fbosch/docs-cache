export type CliOptions = {
	config?: string;
	cacheDir?: string;
	offline: boolean;
	failOnMiss: boolean;
	concurrency?: number;
	json: boolean;
	timeoutMs?: number;
};
