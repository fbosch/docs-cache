#!/usr/bin/env node

const CLI_NAME = "docs";

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

const printHelp = () => {
	process.stdout.write(HELP_TEXT.trimStart());
};

const isHelpRequest = (args: string[]) =>
	args.length === 0 || args.some((arg) => HELP_FLAGS.has(arg));

const runCommand = async (command: Command) => {
	process.stdout.write(`${CLI_NAME} ${command}: not implemented yet.\n`);
};

const main = async () => {
	const args = process.argv.slice(2);

	if (isHelpRequest(args)) {
		printHelp();
		return;
	}

	const command = args[0];
	if (!command || !COMMAND_SET.has(command)) {
		process.stderr.write(
			`${CLI_NAME}: unknown command${command ? ` '${command}'` : ""}.\n`,
		);
		printHelp();
		process.exitCode = 1;
		return;
	}

	await runCommand(command as Command);
};

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`${CLI_NAME}: ${message}\n`);
	process.exitCode = 1;
});
