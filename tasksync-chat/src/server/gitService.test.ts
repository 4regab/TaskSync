import { afterEach, describe, expect, it } from "vitest";
import * as vscode from "vscode";
import { isValidFilePath } from "../server/gitService";

describe("isValidFilePath", () => {
	afterEach(() => {
		(
			vscode.workspace as unknown as { workspaceFolders: unknown[] }
		).workspaceFolders = [];
	});

	describe("valid paths", () => {
		it("accepts simple filenames", () => {
			expect(isValidFilePath("file.txt")).toBe(true);
			expect(isValidFilePath("README.md")).toBe(true);
		});

		it("accepts relative paths", () => {
			expect(isValidFilePath("src/app.ts")).toBe(true);
			expect(isValidFilePath("path/to/file.js")).toBe(true);
		});

		it("rejects absolute paths (no workspace root in test)", () => {
			expect(isValidFilePath("/home/user/file.txt")).toBe(false);
			expect(isValidFilePath("/Users/dev/project/src/app.ts")).toBe(false);
		});

		it("accepts absolute paths under any workspace folder", () => {
			(
				vscode.workspace as unknown as {
					workspaceFolders: Array<{ uri: { fsPath: string } }>;
				}
			).workspaceFolders = [
				{ uri: { fsPath: "/workspace/root-a" } },
				{ uri: { fsPath: "/workspace/root-b" } },
			];
			expect(isValidFilePath("/workspace/root-b/src/app.ts")).toBe(true);
			expect(isValidFilePath("/workspace/root-a/README.md")).toBe(true);
		});

		it("accepts paths with dots (non-traversal)", () => {
			expect(isValidFilePath(".gitignore")).toBe(true);
			expect(isValidFilePath("src/.env")).toBe(true);
		});

		it("accepts paths with hyphens and underscores", () => {
			expect(isValidFilePath("my-file.ts")).toBe(true);
			expect(isValidFilePath("my_file.ts")).toBe(true);
			expect(isValidFilePath("src/my-component/index.tsx")).toBe(true);
		});

		it("accepts paths with spaces", () => {
			expect(isValidFilePath("my file.txt")).toBe(true);
			expect(isValidFilePath("path/with spaces/file.js")).toBe(true);
		});

		it("allows paths with backslash (Windows paths)", () => {
			expect(isValidFilePath("file\\name")).toBe(true);
			expect(isValidFilePath("src\\app.ts")).toBe(true);
		});
	});

	describe("invalid paths", () => {
		it("rejects empty/whitespace paths", () => {
			expect(isValidFilePath("")).toBe(false);
			expect(isValidFilePath("   ")).toBe(false);
		});

		it("rejects paths with shell metacharacters", () => {
			expect(isValidFilePath("file`cmd`")).toBe(false);
			expect(isValidFilePath("file$HOME")).toBe(false);
			expect(isValidFilePath("file|pipe")).toBe(false);
			expect(isValidFilePath("file;rm -rf")).toBe(false);
			expect(isValidFilePath("file&bg")).toBe(false);
			expect(isValidFilePath("file<input")).toBe(false);
			expect(isValidFilePath("file>output")).toBe(false);
			expect(isValidFilePath("file(paren")).toBe(false);
			expect(isValidFilePath("file{brace")).toBe(false);
		});

		it("allows bracket characters used in route filenames", () => {
			expect(isValidFilePath("src/app/[id].tsx")).toBe(true);
			expect(isValidFilePath("src/pages/[...slug].ts")).toBe(true);
		});

		it("rejects paths with quotes", () => {
			expect(isValidFilePath('file"name')).toBe(false);
			expect(isValidFilePath("file'name")).toBe(false);
		});

		it("rejects paths with null bytes", () => {
			expect(isValidFilePath("file\x00name")).toBe(false);
		});

		it("rejects paths with newlines", () => {
			expect(isValidFilePath("file\nname")).toBe(false);
			expect(isValidFilePath("file\rname")).toBe(false);
		});

		it("rejects paths with glob characters", () => {
			expect(isValidFilePath("*.ts")).toBe(false);
			expect(isValidFilePath("file?.txt")).toBe(false);
			expect(isValidFilePath("src/**")).toBe(false);
		});

		it("rejects paths with directory traversal", () => {
			expect(isValidFilePath("../../etc/passwd")).toBe(false);
			expect(isValidFilePath("../secret")).toBe(false);
		});

		it("allows internal .. that resolves within path", () => {
			// "src/../lib/file.ts" normalizes to "lib/file.ts" which doesn't start with ".."
			expect(isValidFilePath("src/../lib/file.ts")).toBe(true);
		});
	});
});
