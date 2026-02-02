export type ErrnoException = NodeJS.ErrnoException;

export const isErrnoException = (error: unknown): error is ErrnoException =>
	typeof error === "object" &&
	error !== null &&
	"code" in error &&
	(typeof (error as ErrnoException).code === "string" ||
		typeof (error as ErrnoException).code === "number" ||
		(error as ErrnoException).code === undefined);

export const getErrnoCode = (error: unknown): string | undefined =>
	isErrnoException(error) && typeof error.code === "string"
		? error.code
		: undefined;
