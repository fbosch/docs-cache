const CREDENTIAL_RE = /^(https?:\/\/)([^@]+)@/i;

export const redactRepoUrl = (repo: string) => {
	// Redact any credentials (user:pass or token) before @ in HTTP(S) URLs
	return repo.replace(CREDENTIAL_RE, "$1***@");
};
