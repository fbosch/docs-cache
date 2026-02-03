import pc from "picocolors";
import { createLiveOutput, type LiveOutput } from "./live-output";
import { symbols } from "./ui";

type TaskState = "pending" | "running" | "success" | "warn" | "error";

export type TaskReporterOptions = {
	maxLiveLines?: number;
	output?: LiveOutput;
};

export class TaskReporter {
	private readonly output: LiveOutput;
	private readonly maxLiveLines: number;
	private readonly startTime = Date.now();
	private readonly tasks = new Map<string, TaskState>();
	private readonly results: string[] = [];
	private readonly liveLines: string[] = [];
	private readonly hasTty = Boolean(process.stdout.isTTY);
	private warnings = 0;
	private errors = 0;

	constructor(options: TaskReporterOptions = {}) {
		this.output = options.output ?? createLiveOutput();
		this.maxLiveLines = options.maxLiveLines ?? 4;
	}

	start(label: string) {
		this.tasks.set(label, "running");
		this.render();
	}

	info(label: string, details?: string) {
		this.results.push(this.formatLine(symbols.info, label, details));
		this.render();
	}

	warn(label: string, details?: string) {
		this.warnings += 1;
		this.results.push(this.formatLine(symbols.warn, label, details));
		this.render();
	}

	error(label: string, details?: string) {
		this.errors += 1;
		this.results.push(this.formatLine(symbols.error, label, details));
		this.render();
	}

	success(label: string, details?: string) {
		this.tasks.set(label, "success");
		this.results.push(this.formatLine(symbols.success, label, details));
		this.render();
	}

	debug(text: string) {
		this.liveLines.push(pc.dim(text));
		if (this.liveLines.length > this.maxLiveLines) {
			this.liveLines.splice(0, this.liveLines.length - this.maxLiveLines);
		}
		this.render();
	}

	finish(summary?: string) {
		const durationMs = Date.now() - this.startTime;
		const parts = [
			`Completed in ${durationMs.toFixed(0)}ms`,
			this.warnings
				? `${this.warnings} warning${this.warnings === 1 ? "" : "s"}`
				: null,
			this.errors
				? `${this.errors} error${this.errors === 1 ? "" : "s"}`
				: null,
		].filter(Boolean) as string[];
		const suffix = parts.length ? ` · ${parts.join(" · ")}` : "";
		const message = summary
			? `${summary}${suffix}`
			: `${symbols.info}${suffix}`;
		this.output.persist(this.composeView([message]));
	}

	stop() {
		this.output.stop();
	}

	private render() {
		if (!this.hasTty) return;
		this.output.render(this.composeView());
	}

	private composeView(extraFooter?: string[]) {
		const running = Array.from(this.tasks.entries())
			.filter(([, state]) => state === "running")
			.map(([label]) => `${pc.cyan("→")} ${label}`);
		const lines = [
			...this.results,
			...running,
			...this.liveLines,
			...(extraFooter ?? []),
		].filter((line) => line.length > 0);
		return lines.length > 0 ? lines : [" "];
	}

	private formatLine(icon: string, label: string, details?: string) {
		const partLabel = pc.bold(label);
		const partDetails = details ? pc.gray(details) : "";
		return `  ${icon} ${partLabel} ${partDetails}`.trimEnd();
	}
}
