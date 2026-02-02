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
	silent: boolean;
};

export type CliCommand =
	| { command: "add"; args: string[]; options: CliOptions }
	| { command: "remove"; args: string[]; options: CliOptions }
	| { command: "sync"; args: string[]; options: CliOptions }
	| { command: "status"; args: string[]; options: CliOptions }
	| { command: "clean"; args: string[]; options: CliOptions }
	| { command: "clean-cache"; args: string[]; options: CliOptions }
	| { command: "prune"; args: string[]; options: CliOptions }
	| { command: "verify"; args: string[]; options: CliOptions }
	| { command: "init"; args: string[]; options: CliOptions }
	| { command: null; args: string[]; options: CliOptions };
