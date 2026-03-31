import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["src/**/*.test.ts"],
		alias: {
			vscode: new URL("./src/__mocks__/vscode.ts", import.meta.url).pathname,
		},
		coverage: {
			provider: "v8",
			include: [
				"src/constants/**/*.ts",
				"src/utils/**/*.ts",
				"src/webview/choiceParser.ts",
				"src/webview/webviewUtils.ts",
				"src/server/serverUtils.ts",
				"src/server/gitService.ts",
				"src/webview/queueHandlers.ts",
				"src/webview/settingsHandlers.ts",
			],
			exclude: ["src/**/*.test.ts", "src/__mocks__/**"],
		},
	},
});
