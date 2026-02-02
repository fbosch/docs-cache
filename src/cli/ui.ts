import path from "node:path";
import pc from "picocolors";
import { toPosixPath } from "../paths";

export const symbols = {
	error: pc.red("✖"),
	success: pc.green("✔"),
	info: pc.blue("ℹ"),
	warn: pc.yellow("⚠"),
};

let _silentMode = false;

export const setSilentMode = (silent: boolean) => {
	_silentMode = silent;
};

export const ui = {
	// Formatters
	path: (value: string) => {
		const rel = path.relative(process.cwd(), value);
		const selected = rel.length < value.length ? rel : value;
		return toPosixPath(selected);
	},
	hash: (value: string | null | undefined) => {
		return value ? value.slice(0, 7) : "-";
	},

	// Layout
	pad: (value: string, length: number) => value.padEnd(length),

	// Components
	line: (text: string = "") => {
		if (_silentMode) return;
		process.stdout.write(`${text}\n`);
	},

	header: (label: string, value: string) => {
		if (_silentMode) return;
		process.stdout.write(`${pc.blue("ℹ")} ${label.padEnd(10)} ${value}\n`);
	},

	item: (icon: string, label: string, details?: string) => {
		if (_silentMode) return;
		const partLabel = pc.bold(label);
		const partDetails = details ? pc.gray(details) : "";
		process.stdout.write(`  ${icon} ${partLabel} ${partDetails}\n`);
	},

	step: (action: string, subject: string, details?: string) => {
		if (_silentMode) return;
		const icon = pc.cyan("→");
		process.stdout.write(
			`  ${icon} ${action} ${pc.bold(subject)}${details ? ` ${pc.dim(details)}` : ""}\n`,
		);
	},
};
