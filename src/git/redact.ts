const CREDENTIAL_RE = /^(https?:\/\/)([^@]+)@/i;

export const redactRepoUrl = (repo: string) => {
	// Redact any credentials before @ in HTTP(S) URLs
	let redacted = repo.replace(CREDENTIAL_RE, "$1***@");
	// Also handle user:password@ format explicitly
	redacted = redacted.replace(/\/\/[^@:]+:[^@:]+@/, "//*****:*****@");
	return redacted;
};
