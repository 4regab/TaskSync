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

export default {
	Uri,
	workspace,
	window,
	extensions,
	ConfigurationTarget,
	ExtensionContext,
};
