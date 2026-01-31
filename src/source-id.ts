const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_ID_LENGTH = 200;
const RESERVED_NAMES = new Set([
	".",
	"..",
	"CON",
	"PRN",
	"AUX",
	"NUL",
	"COM1",
	"LPT1",
]);

export const assertSafeSourceId = (value: unknown, label: string): string => {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label} must be a non-empty string.`);
	}
	if (value.length > MAX_ID_LENGTH) {
		throw new Error(`${label} exceeds maximum length of ${MAX_ID_LENGTH}.`);
	}
	if (!SAFE_ID_PATTERN.test(value)) {
		throw new Error(
			`${label} must contain only alphanumeric characters, hyphens, and underscores.`,
		);
	}
	if (RESERVED_NAMES.has(value.toUpperCase())) {
		throw new Error(`${label} uses reserved name '${value}'.`);
	}
	return value;
};
