import pc from "picocolors";
import { createLiveOutput, type LiveOutput } from "./live-output";
import { symbols } from "./ui";

type TaskState = "pending" | "running" | "success" | "warn" | "error";

const formatDuration = (ms: number) => {
	const seconds = Math.max(0, ms / 1000);
	if (seconds < 60) {
		return `${seconds.toFixed(1)}s`;
	}
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;
	return `${minutes}m ${remainder.toFixed(1)}s`;
};

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
	private timer: NodeJS.Timeout | null = null;
	private warnings = 0;
	private errors = 0;

	constructor(options: TaskReporterOptions = {}) {
		this.output = options.output ?? createLiveOutput();
		this.maxLiveLines = options.maxLiveLines ?? 4;
		this.startTimer();
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
		this.liveLines.length = 0;
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
		this.liveLines.length = 0;
		const durationMs = Date.now() - this.startTime;
		const parts = [
			`Completed in ${formatDuration(durationMs)}`,
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
		this.stopTimer();
	}

	stop() {
		this.output.stop();
		this.stopTimer();
	}

	private render() {
		if (!this.hasTty) return;
		this.output.render(this.composeView());
	}

	private startTimer() {
		if (!this.hasTty) return;
		this.timer = setInterval(() => {
			if (this.hasRunningTasks()) {
				this.render();
			}
		}, 250);
		this.timer.unref?.();
	}

	private stopTimer() {
		if (!this.timer) return;
		clearInterval(this.timer);
		this.timer = null;
	}

	private composeView(extraFooter?: string[]) {
		const running = Array.from(this.tasks.entries())
			.filter(([, state]) => state === "running")
			.map(([label]) => `${pc.cyan("→")} ${label}`);
		const elapsed = this.hasRunningTasks()
			? pc.dim(`time: ${formatDuration(Date.now() - this.startTime)}`)
			: "";
		const lines = [
			...this.results,
			...running,
			...this.liveLines,
			elapsed,
			...(extraFooter ?? []),
		].filter((line) => line.length > 0);
		return lines.length > 0 ? lines : [" "];
	}

	private hasRunningTasks() {
		for (const state of this.tasks.values()) {
			if (state === "running") return true;
		}
		return false;
	}

	private formatLine(icon: string, label: string, details?: string) {
		const partLabel = pc.bold(label);
		const partDetails = details ? pc.gray(details) : "";
		return `  ${icon} ${partLabel} ${partDetails}`.trimEnd();
	}
}
