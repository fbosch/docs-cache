const resolveGitCommand = (): string => {
	// Allow tests to override git command path
	const override = process.env.DOCS_CACHE_GIT_COMMAND;
	if (override) {
		return override;
	}
	return "git";
};

const buildGitEnv = (): NodeJS.ProcessEnv => {
	const pathValue = process.env.PATH ?? process.env.Path;
	const pathExtValue =
		process.env.PATHEXT ??
		(process.platform === "win32" ? ".COM;.EXE;.BAT;.CMD" : undefined);
	return {
		...process.env,
		...(pathValue ? { PATH: pathValue, Path: pathValue } : {}),
		...(pathExtValue ? { PATHEXT: pathExtValue } : {}),
		HOME: process.env.HOME,
		USER: process.env.USER,
		USERPROFILE: process.env.USERPROFILE,
		TMPDIR: process.env.TMPDIR,
		TMP: process.env.TMP,
		TEMP: process.env.TEMP,
		SYSTEMROOT: process.env.SYSTEMROOT,
		WINDIR: process.env.WINDIR,
		SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
		SSH_AGENT_PID: process.env.SSH_AGENT_PID,
		HTTP_PROXY: process.env.HTTP_PROXY,
		HTTPS_PROXY: process.env.HTTPS_PROXY,
		NO_PROXY: process.env.NO_PROXY,
		GIT_TERMINAL_PROMPT: "0",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_NOGLOBAL: "1",
		...(process.platform === "win32" ? {} : { GIT_ASKPASS: "/bin/false" }),
	};
};

export { buildGitEnv, resolveGitCommand };
