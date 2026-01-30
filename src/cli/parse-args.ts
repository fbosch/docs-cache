import process from "node:process";
import { ExitCode } from "./exit-code";
import type { CliOptions } from "./types";

const HELP_FLAGS = new Set(["-h", "--help", "help"]);
const COMMANDS = ["add", "sync", "status", "clean", "prune", "verify"] as const;
type Command = (typeof COMMANDS)[number];

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
		lockOnly: false,
		json: false,
	};
	const positionals: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (!arg.startsWith("--")) {
			positionals.push(arg);
			continue;
		}
		if (HELP_FLAGS.has(arg)) {
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
			case "--target-dir": {
				const { value, nextIndex } = inlineValue
					? { value: inlineValue, nextIndex: index }
					: readValue(args, index, flag);
				options.targetDir = value;
				index = nextIndex;
				break;
			}
			case "--lock-only":
				options.lockOnly = true;
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

export type ParsedArgs = {
	command: Command | null;
	options: CliOptions;
	positionals: string[];
	help: boolean;
};

export const parseArgs = (argv = process.argv): ParsedArgs => {
	try {
		const args = argv.slice(2);
		if (args.length === 0) {
			return {
				command: null,
				options: {
					offline: false,
					failOnMiss: false,
					lockOnly: false,
					json: false,
				},
				positionals: [],
				help: true,
			};
		}

		const { command, optionArgs } = splitArgs(args);
		if (command && HELP_FLAGS.has(command)) {
			return {
				command: null,
				options: {
					offline: false,
					failOnMiss: false,
					lockOnly: false,
					json: false,
				},
				positionals: [],
				help: true,
			};
		}

		if (command && !COMMANDS.includes(command as Command)) {
			throw new Error(`Unknown command '${command}'.`);
		}

		const help = optionArgs.some((arg) => HELP_FLAGS.has(arg));
		const parsed = parseOptions(optionArgs);

		return {
			command: command as Command | null,
			options: parsed.options,
			positionals: parsed.positionals,
			help,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		process.exit(ExitCode.InvalidArgument);
	}
};
