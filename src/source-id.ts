const INVALID_ID_PATTERN = /[<>:"/\\|?*]/;
const TRAILING_DOT_SPACE_PATTERN = /[.\s]+$/;
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
	if (value.trim().length === 0) {
		throw new Error(`${label} must not be blank.`);
	}
	if (value.length > MAX_ID_LENGTH) {
		throw new Error(`${label} exceeds maximum length of ${MAX_ID_LENGTH}.`);
	}
	for (const char of value) {
		const code = char.codePointAt(0);
		if (code !== undefined && (code <= 0x1f || code === 0x7f)) {
			throw new Error(`${label} must not contain control characters.`);
		}
	}
	if (TRAILING_DOT_SPACE_PATTERN.test(value)) {
		throw new Error(`${label} must not end with dots or spaces.`);
	}
	if (INVALID_ID_PATTERN.test(value) || value.includes("\0")) {
		throw new Error(
			`${label} must not contain path separators or reserved characters (< > : " / \\ | ? *).`,
		);
	}
	const normalized = value.replace(/[.\s]+$/g, "");
	if (RESERVED_NAMES.has(normalized.toUpperCase())) {
		throw new Error(`${label} uses reserved name '${value}'.`);
	}
	return value;
};
