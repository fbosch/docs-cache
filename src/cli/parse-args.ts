import process from "node:process";

import cac from "cac";
import { ExitCode } from "#cli/exit-code";
import type { AddEntry, CliCommand, CliOptions } from "./types";

const COMMANDS = [
	"add",
	"remove",
	"pin",
	"update",
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
const SCOPED_SOURCE_OPTIONS = new Set(["--all", "--dry-run"]);
const POSITIONAL_SKIP_OPTIONS = new Set([
	"--config",
	"--cache-dir",
	"--concurrency",
	"--timeout-ms",
]);
const ADD_ONLY_OPTIONS_WITH_VALUES = new Set([
	"--id",
	"--source",
	"--target",
	"--target-dir",
]);

const ADD_ENTRY_SKIP_OPTIONS = new Set([
	"--config",
	"--cache-dir",
	"--concurrency",
	"--timeout-ms",
]);

const VALUE_FLAGS = new Set([
	...POSITIONAL_SKIP_OPTIONS,
	...ADD_ONLY_OPTIONS_WITH_VALUES,
]);

type AddParseState = {
	entries: AddEntry[];
	lastIndex: number;
	pendingId: string | null;
	lastWasRepoAdded: boolean;
};

const getArgValue = (arg: string, next: string | undefined, flag: string) => {
	const rawValue = arg === flag ? next : arg.slice(flag.length + 1);
	if (!rawValue || rawValue.startsWith("-")) {
		throw new Error(`${flag} expects a value.`);
	}
	return rawValue;
};

const addEntry = (state: AddParseState, repo: string) => {
	state.entries.push({
		repo,
		...(state.pendingId ? { id: state.pendingId } : {}),
	});
	state.lastIndex = state.entries.length - 1;
	state.pendingId = null;
	state.lastWasRepoAdded = true;
};

const applyPendingId = (state: AddParseState, value: string) => {
	const canApply =
		state.lastWasRepoAdded &&
		state.lastIndex !== -1 &&
		state.entries[state.lastIndex]?.id === undefined &&
		state.pendingId === null;
	if (!canApply) {
		if (state.pendingId !== null) {
			throw new Error("--id must be followed by a source.");
		}
		state.pendingId = value;
		state.lastWasRepoAdded = false;
		return;
	}
	state.entries[state.lastIndex].id = value;
	state.lastWasRepoAdded = false;
};

const setTarget = (state: AddParseState, targetDir: string) => {
	if (state.lastIndex === -1) {
		throw new Error("--target must follow a --source entry.");
	}
	state.entries[state.lastIndex].targetDir = targetDir;
	state.lastWasRepoAdded = false;
};

const findCommandIndex = (rawArgs: string[]) => {
	for (let index = 0; index < rawArgs.length; index += 1) {
		const arg = rawArgs[index];
		if (arg.startsWith("--")) {
			const [flag] = arg.split("=");
			if (VALUE_FLAGS.has(flag) && !arg.includes("=")) {
				index += 1;
			}
			continue;
		}
		return index;
	}
	return -1;
};

const parseAddEntries = (rawArgs: string[]): AddEntry[] => {
	const commandIndex = findCommandIndex(rawArgs);
	const tail = commandIndex === -1 ? [] : rawArgs.slice(commandIndex + 1);
	const state: AddParseState = {
		entries: [],
		lastIndex: -1,
		pendingId: null,
		lastWasRepoAdded: false,
	};
	for (let index = 0; index < tail.length; index += 1) {
		const arg = tail[index];
		if (arg === "--id" || arg.startsWith("--id=")) {
			const value = getArgValue(arg, tail[index + 1], "--id");
			if (arg === "--id") {
				index += 1;
			}
			applyPendingId(state, value);
			continue;
		}
		if (arg === "--source" || arg.startsWith("--source=")) {
			const value = getArgValue(arg, tail[index + 1], "--source");
			addEntry(state, value);
			if (arg === "--source") {
				index += 1;
			}
			continue;
		}
		if (arg === "--target" || arg.startsWith("--target=")) {
			const value = getArgValue(arg, tail[index + 1], "--target");
			setTarget(state, value);
			if (arg === "--target") {
				index += 1;
			}
			continue;
		}
		if (arg === "--target-dir" || arg.startsWith("--target-dir=")) {
			const value = getArgValue(arg, tail[index + 1], "--target-dir");
			setTarget(state, value);
			if (arg === "--target-dir") {
				index += 1;
			}
			continue;
		}
		if (ADD_ENTRY_SKIP_OPTIONS.has(arg)) {
			index += 1;
			state.lastWasRepoAdded = false;
			continue;
		}
		if (arg.startsWith("--")) {
			state.lastWasRepoAdded = false;
			continue;
		}
		addEntry(state, arg);
	}
	if (state.pendingId !== null) {
		throw new Error("--id must be followed by a source.");
	}
	return state.entries;
};

const parsePositionals = (rawArgs: string[]) => {
	const commandIndex = findCommandIndex(rawArgs);
	const tail = commandIndex === -1 ? [] : rawArgs.slice(commandIndex + 1);
	const positionals: string[] = [];
	for (let index = 0; index < tail.length; index += 1) {
		const arg = tail[index];
		if (POSITIONAL_SKIP_OPTIONS.has(arg)) {
			index += 1;
			continue;
		}
		if (arg.startsWith("--")) {
			continue;
		}
		positionals.push(arg);
	}
	return positionals;
};

const assertAddOnlyOptions = (command: Command | null, rawArgs: string[]) => {
	if (command === "add") {
		for (const arg of rawArgs) {
			const [flag] = arg.split("=");
			if (SCOPED_SOURCE_OPTIONS.has(flag)) {
				throw new Error(`${arg} is only valid for pin or update.`);
			}
		}
		return;
	}
	if (command === "pin" || command === "update") {
		for (const arg of rawArgs) {
			if (ADD_ONLY_OPTIONS.has(arg)) {
				throw new Error(`${arg} is only valid for add.`);
			}
			if (!arg.startsWith("--")) {
				continue;
			}
			const [flag] = arg.split("=");
			if (ADD_ONLY_OPTIONS_WITH_VALUES.has(flag)) {
				throw new Error(`${flag} is only valid for add.`);
			}
		}
		return;
	}
	for (const arg of rawArgs) {
		const [flag] = arg.split("=");
		if (SCOPED_SOURCE_OPTIONS.has(flag)) {
			throw new Error(`${arg} is only valid for pin or update.`);
		}
		if (ADD_ONLY_OPTIONS.has(arg)) {
			throw new Error(`${arg} is only valid for add.`);
		}
		if (!arg.startsWith("--")) {
			continue;
		}
		if (ADD_ONLY_OPTIONS_WITH_VALUES.has(flag)) {
			throw new Error(`${flag} is only valid for add.`);
		}
	}
};

const buildOptions = (result: ReturnType<ReturnType<typeof cac>["parse"]>) => {
	const options: CliOptions = {
		config: result.options.config,
		cacheDir: result.options.cacheDir,
		offline: Boolean(result.options.offline),
		failOnMiss: Boolean(result.options.failOnMiss),
		lockOnly: Boolean(result.options.lockOnly),
		prune: Boolean(result.options.prune),
		all: Boolean(result.options.all),
		dryRun: Boolean(result.options.dryRun),
		frozen: Boolean(result.options.frozen),
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
	if (
		options.concurrency !== undefined &&
		!Number.isFinite(options.concurrency)
	) {
		throw new Error("--concurrency must be a positive number.");
	}
	if (options.timeoutMs !== undefined && options.timeoutMs < 1) {
		throw new Error("--timeout-ms must be a positive number.");
	}
	if (options.timeoutMs !== undefined && !Number.isFinite(options.timeoutMs)) {
		throw new Error("--timeout-ms must be a positive number.");
	}

	return options;
};

const getCommandFromArgs = (rawArgs: string[]) => {
	const commandIndex = findCommandIndex(rawArgs);
	const command =
		commandIndex === -1 ? undefined : (rawArgs[commandIndex] as Command);
	if (command && !COMMANDS.includes(command)) {
		throw new Error(`Unknown command '${command}'.`);
	}
	return command ?? null;
};

const getPositionals = (
	command: Command | null,
	rawArgs: string[],
	entries: AddEntry[] | null,
) => {
	if (command === "add") {
		const addEntries = entries ?? parseAddEntries(rawArgs);
		return { positionals: addEntries.map((entry) => entry.repo), addEntries };
	}
	return { positionals: parsePositionals(rawArgs), addEntries: entries };
};

const buildParsedCommand = (
	command: Command | null,
	options: CliOptions,
	positionals: string[],
	addEntries: AddEntry[] | null,
): CliCommand => {
	switch (command) {
		case "add":
			return {
				command: "add",
				entries: addEntries ?? [],
				options,
			};
		case "remove":
			return { command: "remove", ids: positionals, options };
		case "pin":
			return { command: "pin", ids: positionals, options };
		case "update":
			return { command: "update", ids: positionals, options };
		case "sync":
			return { command: "sync", ids: positionals, options };
		case "status":
			return { command: "status", options };
		case "clean":
			return { command: "clean", options };
		case "clean-cache":
			return { command: "clean-cache", options };
		case "prune":
			return { command: "prune", options };
		case "verify":
			return { command: "verify", options };
		case "init":
			return { command: "init", options };
		default:
			return { command: null, options };
	}
};

export const parseArgs = (argv = process.argv): ParsedArgs => {
	try {
		const cli = cac("docs-cache");

		cli
			.option("--config <path>", "Path to config file")
			.option("--cache-dir <path>", "Override cache directory")
			.option("--all", "Apply command to all sources")
			.option("--dry-run", "Preview changes without writing files")
			.option("--frozen", "Fail if lock and resolved refs differ")
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
		cli.command("pin [id...]", "Pin source refs to current commit");
		cli.command("update [id...]", "Refresh selected sources and lock data");
		cli.command("sync [id...]", "Synchronize cache with config");
		cli.command("status", "Show cache status");
		cli.command("clean", "Remove project cache");
		cli.command("clean-cache", "Clear global git cache");
		cli.command("prune", "Remove unused data");
		cli.command("verify", "Validate cache integrity");
		cli.command("init", "Create a new config interactively");

		const result = cli.parse(argv, { run: false });
		const rawArgs = argv.slice(2);
		const command = getCommandFromArgs(rawArgs);
		const options = buildOptions(result);
		assertAddOnlyOptions(command, rawArgs);
		const { positionals, addEntries } = getPositionals(command, rawArgs, null);
		const parsed = buildParsedCommand(
			command,
			options,
			positionals,
			addEntries,
		);
		return {
			command,
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
