export type SyncOptions = {
	configPath?: string;
	cacheDirOverride?: string;
	json: boolean;
	lockOnly: boolean;
	offline: boolean;
	failOnMiss: boolean;
	frozen?: boolean;
	verbose?: boolean;
	concurrency?: number;
	sourceFilter?: string[];
	timeoutMs?: number;
};

export type SyncResult = {
	id: string;
	repo: string;
	ref: string;
	resolvedCommit: string;
	lockCommit: string | null;
	lockRulesSha256?: string;
	status: "up-to-date" | "changed" | "missing";
	bytes?: number;
	fileCount?: number;
	manifestSha256?: string;
	rulesSha256?: string;
};
