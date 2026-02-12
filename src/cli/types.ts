export type CliOptions = {
	config?: string;
	cacheDir?: string;
	offline: boolean;
	failOnMiss: boolean;
	lockOnly: boolean;
	prune: boolean;
	all: boolean;
	dryRun: boolean;
	concurrency?: number;
	json: boolean;
	timeoutMs?: number;
	silent: boolean;
	verbose: boolean;
};

export type AddEntry = {
	id?: string;
	repo: string;
	targetDir?: string;
};

export type CliCommand =
	| { command: "add"; entries: AddEntry[]; options: CliOptions }
	| { command: "remove"; ids: string[]; options: CliOptions }
	| { command: "pin"; ids: string[]; options: CliOptions }
	| { command: "sync"; options: CliOptions }
	| { command: "status"; options: CliOptions }
	| { command: "clean"; options: CliOptions }
	| { command: "clean-cache"; options: CliOptions }
	| { command: "prune"; options: CliOptions }
	| { command: "verify"; options: CliOptions }
	| { command: "init"; options: CliOptions }
	| { command: null; options: CliOptions };
