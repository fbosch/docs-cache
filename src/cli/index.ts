import { addSource } from "../add";
import { getStatus, printStatus } from "../status";

export const CLI_NAME = "docs-cache";

export type CliOptions = {
	config?: string;
	cacheDir?: string;
	offline: boolean;
	failOnMiss: boolean;
	concurrency?: number;
	json: boolean;
	timeoutMs?: number;
};

const COMMANDS = ["add", "sync", "status", "clean", "prune", "verify"] as const;
type Command = (typeof COMMANDS)[number];

const HELP_TEXT = `
Usage: ${CLI_NAME} <command> [options]

Commands:
  add     Add a source to the config
  sync    Synchronize cache with config
  status  Show cache status
  clean   Remove cache
  prune   Remove unused data
  verify  Validate cache integrity

Global options:
  --config <path>
  --cache-dir <path>
  --offline
  --fail-on-miss
  --concurrency <n>
  --json
  --timeout-ms <n>
`;

const HELP_FLAGS = new Set(["-h", "--help", "help"]);
const COMMAND_SET = new Set<string>(COMMANDS);

const splitArgs = (args: string[]) => {
	const commandIndex = args.findIndex((arg) => !arg.startsWith("-"));
	if (commandIndex === -1) {
		return { command: null, optionArgs: args };
	}
	const command = args[commandIndex];
	const optionArgs = [
		...args.slice(0, commandIndex),
		...args.slice(commandIndex + 1),
	];
	return { command, optionArgs };
};

const readValue = (args: string[], index: number, flag: string) => {
	const next = args[index + 1];
	if (!next || next.startsWith("-")) {
		throw new Error(`${flag} expects a value.`);
	}
	return { value: next, nextIndex: index + 1 };
};

const parseNumber = (value: string, label: string) => {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 1) {
		throw new Error(`${label} must be a positive number.`);
	}
	return parsed;
};

const parseOptions = (args: string[]) => {
	const options: CliOptions = {
		offline: false,
		failOnMiss: false,
		json: false,
	};
	const positionals: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (!arg.startsWith("--")) {
			positionals.push(arg);
			continue;
		}
		const [flag, inlineValue] = arg.split("=", 2);
		switch (flag) {
			case "--config": {
				const { value, nextIndex } = inlineValue
					? { value: inlineValue, nextIndex: index }
					: readValue(args, index, flag);
				options.config = value;
				index = nextIndex;
				break;
			}
			case "--cache-dir": {
				const { value, nextIndex } = inlineValue
					? { value: inlineValue, nextIndex: index }
					: readValue(args, index, flag);
				options.cacheDir = value;
				index = nextIndex;
				break;
			}
			case "--offline":
				options.offline = true;
				break;
			case "--fail-on-miss":
				options.failOnMiss = true;
				break;
			case "--json":
				options.json = true;
				break;
			case "--concurrency": {
				const { value, nextIndex } = inlineValue
					? { value: inlineValue, nextIndex: index }
					: readValue(args, index, flag);
				options.concurrency = parseNumber(value, "--concurrency");
				index = nextIndex;
				break;
			}
			case "--timeout-ms": {
				const { value, nextIndex } = inlineValue
					? { value: inlineValue, nextIndex: index }
					: readValue(args, index, flag);
				options.timeoutMs = parseNumber(value, "--timeout-ms");
				index = nextIndex;
				break;
			}
			default:
				throw new Error(`Unknown option '${flag}'.`);
		}
	}
	return { options, positionals };
};

const printHelp = () => {
	process.stdout.write(HELP_TEXT.trimStart());
};

const isHelpRequest = (args: string[]) =>
	args.length === 0 || args.some((arg) => HELP_FLAGS.has(arg));

const runCommand = async (
	command: Command,
	options: CliOptions,
	positionals: string[],
) => {
	if (command === "add") {
		const [id, repo] = positionals;
		if (!id || !repo) {
			throw new Error("Usage: docs-cache add <id> <repo>");
		}
		const result = await addSource({
			configPath: options.config,
			id,
			repo,
		});
		if (options.json) {
			process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		} else {
			process.stdout.write(
				`Added ${result.sourceId} -> ${result.sourceRepo} in ${result.configPath}\n`,
			);
		}
		return;
	}
	if (command === "status") {
		const status = await getStatus({
			configPath: options.config,
			cacheDirOverride: options.cacheDir,
			json: options.json,
		});
		if (options.json) {
			process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
		} else {
			printStatus(status);
		}
		return;
	}
	process.stdout.write(`${CLI_NAME} ${command}: not implemented yet.\n`);
};

export const main = async (args = process.argv.slice(2)) => {
	if (isHelpRequest(args)) {
		printHelp();
		return;
	}

	const { command, optionArgs } = splitArgs(args);
	if (!command || !COMMAND_SET.has(command)) {
		process.stderr.write(
			`${CLI_NAME}: unknown command${command ? ` '${command}'` : ""}.\n`,
		);
		printHelp();
		process.exitCode = 1;
		return;
	}
	if (HELP_FLAGS.has(command)) {
		printHelp();
		return;
	}
	let options: CliOptions;
	let positionals: string[];
	try {
		const parsed = parseOptions(optionArgs);
		options = parsed.options;
		positionals = parsed.positionals;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`${CLI_NAME}: ${message}\n`);
		printHelp();
		process.exitCode = 1;
		return;
	}

	if (command !== "add" && positionals.length > 0) {
		process.stderr.write(`${CLI_NAME}: unexpected arguments.\n`);
		printHelp();
		process.exitCode = 1;
		return;
	}

	await runCommand(command as Command, options, positionals);
};
