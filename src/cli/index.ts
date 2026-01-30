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

const COMMANDS = ["sync", "status", "clean", "prune", "verify"] as const;
type Command = (typeof COMMANDS)[number];

const HELP_TEXT = `
Usage: ${CLI_NAME} <command> [options]

Commands:
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

const parseOptions = (args: string[]): CliOptions => {
	const options: CliOptions = {
		offline: false,
		failOnMiss: false,
		json: false,
	};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (!arg.startsWith("--")) {
			throw new Error(`Unknown argument '${arg}'.`);
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
	return options;
};

const printHelp = () => {
	process.stdout.write(HELP_TEXT.trimStart());
};

const isHelpRequest = (args: string[]) =>
	args.length === 0 || args.some((arg) => HELP_FLAGS.has(arg));

const runCommand = async (command: Command, options: CliOptions) => {
	if (options) {
		void options;
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
	try {
		options = parseOptions(optionArgs);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`${CLI_NAME}: ${message}\n`);
		printHelp();
		process.exitCode = 1;
		return;
	}

	await runCommand(command as Command, options);
};
