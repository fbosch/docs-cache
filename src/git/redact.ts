const CREDENTIAL_RE = /^(https?:\/\/)([^@]+)@/i;

export const redactRepoUrl = (repo: string) =>
	repo.replace(CREDENTIAL_RE, "$1***@");
