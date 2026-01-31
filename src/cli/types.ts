export type CliOptions = {
	config?: string;
	cacheDir?: string;
	offline: boolean;
	failOnMiss: boolean;
	lockOnly: boolean;
	prune: boolean;
	targetDir?: string;
	concurrency?: number;
	json: boolean;
	timeoutMs?: number;
};
