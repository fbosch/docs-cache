export const resolveRepoInput = (repo: string) => {
	const trimmed = repo.trim();
	const sshMatch = trimmed.match(/^git@([^:]+):(.+)$/);
	if (sshMatch) {
		const host = sshMatch[1];
		const rawPath = sshMatch[2];
		const [pathPart, rawRef] = rawPath.split("#", 2);
		const sanitizedPath = pathPart.replace(/^\//, "");
		const inferredId = sanitizedPath
			.split("/")
			.filter(Boolean)
			.pop()
			?.replace(/\.git$/i, "");
		const repoUrl = `git@${host}:${sanitizedPath}`;
		const ref = rawRef?.trim() || undefined;
		return { repoUrl, ref, inferredId };
	}
	const plainMatch = trimmed.match(/^([^\s/:]+)\/([^\s#]+)(?:#(.+))?$/);
	if (plainMatch) {
		const [, owner, name, rawRef] = plainMatch;
		const sanitizedPath = `${owner}/${name}`.replace(/\.git$/i, "");
		const repoUrl = `https://github.com/${sanitizedPath}.git`;
		return {
			repoUrl,
			ref: rawRef?.trim() || undefined,
			inferredId: name.replace(/\.git$/i, ""),
		};
	}
	const shortcutMatch = trimmed.match(/^(github|gitlab):(.+)$/i);
	if (shortcutMatch) {
		const provider = shortcutMatch[1].toLowerCase();
		const rawPath = shortcutMatch[2];
		const [pathPart, rawRef] = rawPath.split("#", 2);
		const sanitizedPath = pathPart.replace(/^\//, "");
		const inferredId = sanitizedPath
			.split("/")
			.filter(Boolean)
			.pop()
			?.replace(/\.git$/i, "");
		const host = provider === "gitlab" ? "gitlab.com" : "github.com";
		const suffix = sanitizedPath.endsWith(".git") ? "" : ".git";
		const repoUrl = `https://${host}/${sanitizedPath}${suffix}`;
		const ref = rawRef?.trim() || undefined;
		return { repoUrl, ref, inferredId };
	}

	try {
		const url = new URL(trimmed);
		if (url.protocol === "https:" || url.protocol === "ssh:") {
			const parts = url.pathname.split("/").filter(Boolean);
			const inferredId = parts.pop()?.replace(/\.git$/i, "");
			return {
				repoUrl: trimmed,
				ref: undefined,
				inferredId,
			};
		}
	} catch {
		// ignore URL parse errors
	}

	return { repoUrl: trimmed, ref: undefined, inferredId: undefined };
};
