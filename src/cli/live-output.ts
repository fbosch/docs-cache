import cliTruncate from "cli-truncate";
import { createLogUpdate } from "log-update";

type LiveOutputOptions = {
	stdout?: NodeJS.WriteStream;
	maxWidth?: number;
};

export type LiveOutput = {
	render: (lines: string[]) => void;
	persist: (lines: string[]) => void;
	clear: () => void;
	stop: () => void;
};

const normalizeLines = (lines: string[]) =>
	lines.map((line) => (line.length === 0 ? line : line));

export const createLiveOutput = (
	options: LiveOutputOptions = {},
): LiveOutput => {
	const stdout = options.stdout ?? process.stdout;
	const updater = createLogUpdate(stdout);
	const maxWidth = options.maxWidth ?? Math.max(20, (stdout.columns ?? 80) - 2);
	const truncate = (line: string) =>
		cliTruncate(line, maxWidth, { position: "end" });

	const render = (lines: string[]) => {
		const output = normalizeLines(lines).map(truncate).join("\n");
		updater(output);
	};

	const persist = (lines: string[]) => {
		const output = normalizeLines(lines).map(truncate).join("\n");
		updater(output);
		updater.done();
	};

	const clear = () => {
		updater.clear();
	};

	const stop = () => {
		updater.done();
	};

	return {
		render,
		persist,
		clear,
		stop,
	};
};
