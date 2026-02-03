import process from "node:process";

import cac from "cac";
import { ExitCode } from "./exit-code";
import type { AddEntry, CliCommand, CliOptions } from "./types";

const COMMANDS = [
	"add",
	"remove",
	"sync",
	"status",
	"clean",
	"clean-cache",
	"prune",
	"verify",
	"init",
] as const;
type Command = (typeof COMMANDS)[number];

export type ParsedArgs = {
	command: Command | null;
	options: CliOptions;
	positionals: string[];
	rawArgs: string[];
	help: boolean;
	parsed: CliCommand;
};

const ADD_ONLY_OPTIONS = new Set([
	"--source",
	"--target",
	"--target-dir",
	"--id",
]);

const parseAddEntries = (rawArgs: string[]): AddEntry[] => {
	const commandIndex = rawArgs.findIndex((arg) => !arg.startsWith("-"));
	const tail = commandIndex === -1 ? [] : rawArgs.slice(commandIndex + 1);
	const entries: AddEntry[] = [];
	let lastIndex = -1;
	let pendingId: string | null = null;
	let lastWasRepoAdded = false;
	const skipNextFor = new Set([
		"--config",
		"--cache-dir",
		"--concurrency",
		"--timeout-ms",
	]);
	for (let index = 0; index < tail.length; index += 1) {
		const arg = tail[index];
		if (arg === "--id" || arg.startsWith("--id=")) {
			const rawValue = arg === "--id" ? tail[index + 1] : arg.slice(5);
			if (!rawValue || rawValue.startsWith("-")) {
				throw new Error("--id expects a value.");
			}
			if (arg === "--id") {
				index += 1;
			}
			if (
				lastWasRepoAdded &&
				lastIndex !== -1 &&
				entries[lastIndex]?.id === undefined &&
				pendingId === null
			) {
				entries[lastIndex].id = rawValue;
				lastWasRepoAdded = false;
				continue;
			}
			if (pendingId !== null) {
				throw new Error("--id must be followed by a source.");
			}
			pendingId = rawValue;
			lastWasRepoAdded = false;
			continue;
		}
		if (arg === "--source") {
			const next = tail[index + 1];
			if (!next || next.startsWith("-")) {
				throw new Error("--source expects a value.");
			}
			entries.push({ repo: next, ...(pendingId ? { id: pendingId } : {}) });
			lastIndex = entries.length - 1;
			pendingId = null;
			lastWasRepoAdded = true;
			index += 1;
			continue;
		}
		if (arg === "--target" || arg === "--target-dir") {
			const next = tail[index + 1];
			if (!next || next.startsWith("-")) {
				throw new Error("--target expects a value.");
			}
			if (lastIndex === -1) {
				throw new Error("--target must follow a --source entry.");
			}
			entries[lastIndex].targetDir = next;
			index += 1;
			lastWasRepoAdded = false;
			continue;
		}
		if (skipNextFor.has(arg)) {
			index += 1;
			lastWasRepoAdded = false;
			continue;
		}
		if (arg.startsWith("--")) {
			lastWasRepoAdded = false;
			continue;
		}
		entries.push({ repo: arg, ...(pendingId ? { id: pendingId } : {}) });
		lastIndex = entries.length - 1;
		pendingId = null;
		lastWasRepoAdded = true;
	}
	if (pendingId !== null) {
		throw new Error("--id must be followed by a source.");
	}
	return entries;
};

const assertAddOnlyOptions = (command: Command | null, rawArgs: string[]) => {
	if (command === "add") {
		return;
	}
	for (const arg of rawArgs) {
		if (ADD_ONLY_OPTIONS.has(arg)) {
			throw new Error(`${arg} is only valid for add.`);
		}
		if (
			arg.startsWith("--id=") ||
			arg.startsWith("--source=") ||
			arg.startsWith("--target=") ||
			arg.startsWith("--target-dir=")
		) {
			throw new Error(`${arg.split("=")[0]} is only valid for add.`);
		}
	}
};

export const parseArgs = (argv = process.argv): ParsedArgs => {
	try {
		const cli = cac("docs-cache");

		cli
			.option("--config <path>", "Path to config file")
			.option("--cache-dir <path>", "Override cache directory")
			.option("--offline", "Disable network access")
			.option("--fail-on-miss", "Fail when required sources are missing")
			.option("--lock-only", "Update lock without materializing files")
			.option("--prune", "Prune cache on remove")
			.option("--concurrency <n>", "Concurrency limit")
			.option("--json", "Output JSON")
			.option("--timeout-ms <n>", "Network timeout in milliseconds")
			.option("--silent", "Suppress non-error output")
			.option("--verbose", "Enable verbose logging")
			.help();

		cli
			.command("add [repo...]", "Add sources to the config")
			.option("--source <repo>", "Source repo")
			.option("--target <dir>", "Target directory for source")
			.option("--target-dir <path>", "Target directory for source")
			.option("--id <id>", "Source id");

		cli.command("remove <id...>", "Remove sources from the config and targets");
		cli.command("sync", "Synchronize cache with config");
		cli.command("status", "Show cache status");
		cli.command("clean", "Remove project cache");
		cli.command("clean-cache", "Clear global git cache");
		cli.command("prune", "Remove unused data");
		cli.command("verify", "Validate cache integrity");
		cli.command("init", "Create a new config interactively");

		const result = cli.parse(argv, { run: false });
		const rawArgs = argv.slice(2);
		const commandIndex = rawArgs.findIndex((arg) => !arg.startsWith("-"));
		const command =
			commandIndex === -1 ? undefined : (rawArgs[commandIndex] as Command);
		if (command && !COMMANDS.includes(command)) {
			throw new Error(`Unknown command '${command}'.`);
		}

		const options: CliOptions = {
			config: result.options.config,
			cacheDir: result.options.cacheDir,
			offline: Boolean(result.options.offline),
			failOnMiss: Boolean(result.options.failOnMiss),
			lockOnly: Boolean(result.options.lockOnly),
			prune: Boolean(result.options.prune),
			concurrency: result.options.concurrency
				? Number(result.options.concurrency)
				: undefined,
			json: Boolean(result.options.json),
			timeoutMs: result.options.timeoutMs
				? Number(result.options.timeoutMs)
				: undefined,
			silent: Boolean(result.options.silent),
			verbose: Boolean(result.options.verbose),
		};

		if (options.concurrency !== undefined && options.concurrency < 1) {
			throw new Error("--concurrency must be a positive number.");
		}
		if (options.timeoutMs !== undefined && options.timeoutMs < 1) {
			throw new Error("--timeout-ms must be a positive number.");
		}

		assertAddOnlyOptions(command ?? null, rawArgs);
		const positionals = [...result.args];
		let parsed: CliCommand;
		switch (command ?? null) {
			case "add":
				parsed = { command: "add", entries: parseAddEntries(rawArgs), options };
				break;
			case "remove":
				parsed = { command: "remove", ids: positionals, options };
				break;
			case "sync":
				parsed = { command: "sync", options };
				break;
			case "status":
				parsed = { command: "status", options };
				break;
			case "clean":
				parsed = { command: "clean", options };
				break;
			case "clean-cache":
				parsed = { command: "clean-cache", options };
				break;
			case "prune":
				parsed = { command: "prune", options };
				break;
			case "verify":
				parsed = { command: "verify", options };
				break;
			case "init":
				parsed = { command: "init", options };
				break;
			default:
				parsed = { command: null, options };
				break;
		}
		return {
			command: command ?? null,
			options,
			positionals,
			rawArgs,
			help: Boolean(result.options.help),
			parsed,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		process.exit(ExitCode.InvalidArgument);
	}
};
