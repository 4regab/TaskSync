/**
 * Minimal VS Code API mock for unit tests.
 * Only stubs the surface area actually used by the source modules under test.
 */

export const Uri = {
	file: (path: string) => ({ fsPath: path, scheme: "file", path }),
	parse: (str: string) => ({ fsPath: str, scheme: "file", path: str }),
};

export const workspace = {
	getConfiguration: () => ({
		get: () => undefined,
		update: async () => {},
		inspect: () => undefined,
	}),
	workspaceFolders: [],
	getWorkspaceFolder: (uri: { fsPath: string }) => {
		const folders = workspace.workspaceFolders as Array<{
			uri: { fsPath: string };
		}>;
		const match = folders.find((folder) => {
			const root = folder.uri.fsPath;
			return uri.fsPath === root || uri.fsPath.startsWith(`${root}/`);
		});
		return match;
	},
	asRelativePath: (pathOrUri: string | { fsPath: string }) => {
		const p = typeof pathOrUri === "string" ? pathOrUri : pathOrUri.fsPath;
		return p.replace(/^\/workspace\//, "");
	},
};

export const window = {
	showInformationMessage: async () => undefined,
	showWarningMessage: async () => undefined,
	showErrorMessage: async () => undefined,
	activeTextEditor: undefined as any,
};

export const extensions = {
	getExtension: () => undefined as any,
};

export const ConfigurationTarget = {
	Global: 1,
	Workspace: 2,
	WorkspaceFolder: 3,
};

export const ExtensionContext = {};

const vscodeMock = {
	Uri,
	workspace,
	window,
	extensions,
	ConfigurationTarget,
	ExtensionContext,
};

// Allow runtime fallback in non-VS Code test runners (e.g., Bun) without extra config.
(
	globalThis as { __TASKSYNC_VSCODE_MOCK__?: typeof vscodeMock }
).__TASKSYNC_VSCODE_MOCK__ = vscodeMock;

export default vscodeMock;
