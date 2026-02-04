/**
 * CLI exit codes.
 *
 * @see https://nodejs.org/api/process.html#process_exit_codes
 */
export const ExitCode = {
	Success: 0,
	FatalError: 1,
	InvalidArgument: 9,
};

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
