import { describe, expect, it } from "vitest";
import { isValidFilePath } from "../server/gitService";

describe("isValidFilePath", () => {
	describe("valid paths", () => {
		it("accepts simple filenames", () => {
			expect(isValidFilePath("file.txt")).toBe(true);
			expect(isValidFilePath("README.md")).toBe(true);
		});

		it("accepts relative paths", () => {
			expect(isValidFilePath("src/app.ts")).toBe(true);
			expect(isValidFilePath("path/to/file.js")).toBe(true);
		});

		it("accepts absolute paths", () => {
			expect(isValidFilePath("/home/user/file.txt")).toBe(true);
			expect(isValidFilePath("/Users/dev/project/src/app.ts")).toBe(true);
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
			expect(isValidFilePath("file[bracket")).toBe(false);
		});

		it("rejects paths with quotes", () => {
			expect(isValidFilePath('file"name')).toBe(false);
			expect(isValidFilePath("file'name")).toBe(false);
		});

		it("rejects paths with backslash", () => {
			expect(isValidFilePath("file\\name")).toBe(false);
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
