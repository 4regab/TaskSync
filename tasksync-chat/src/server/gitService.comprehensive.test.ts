import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { GitService, isValidFilePath } from "../server/gitService";

// Mock child_process.spawn
vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
}));

// ─── Mock helpers ────────────────────────────────────────────

function createMockRepo(overrides: Partial<any> = {}) {
	return {
		state: {
			indexChanges: [],
			workingTreeChanges: [],
			...overrides.state,
		},
		diffWithHEAD: vi.fn().mockResolvedValue("diff output"),
		add: vi.fn().mockResolvedValue(undefined),
		clean: vi.fn().mockResolvedValue(undefined),
		commit: vi.fn().mockResolvedValue(undefined),
		push: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

function createMockGitAPI(repos: any[] = []) {
	return {
		repositories: repos,
		getRepository: vi.fn().mockReturnValue(null),
	};
}

function setupGitExtension(api: any, isActive = true) {
	const ext = {
		isActive,
		activate: vi.fn().mockResolvedValue(undefined),
		exports: { getAPI: vi.fn().mockReturnValue(api) },
	};
	vi.spyOn(vscode.extensions, "getExtension").mockReturnValue(ext as any);
	return ext;
}

// ─── isValidFilePath (already tested, but adding edge cases) ─

describe("isValidFilePath edge cases", () => {
	it("rejects null-byte injection", () => {
		expect(isValidFilePath("file\x00.txt")).toBe(false);
	});

	it("accepts deeply nested valid paths", () => {
		expect(isValidFilePath("a/b/c/d/e/f/g.ts")).toBe(true);
	});

	it("allows .. in middle of path that normalizes safely", () => {
		// "a/b/../c" normalizes to "a/c" — does not start with ".."
		expect(isValidFilePath("a/b/../c")).toBe(true);
	});
});

// ─── GitService.initialize ──────────────────────────────────

describe("GitService.initialize", () => {
	let service: GitService;

	beforeEach(() => {
		service = new GitService();
		vi.restoreAllMocks();
	});

	it("initializes successfully with active git extension", async () => {
		const api = createMockGitAPI();
		setupGitExtension(api);

		await service.initialize();
		expect(service.isInitialized()).toBe(true);
	});

	it("activates inactive git extension", async () => {
		const api = createMockGitAPI();
		const ext = setupGitExtension(api, false);

		await service.initialize();
		expect(ext.activate).toHaveBeenCalled();
		expect(service.isInitialized()).toBe(true);
	});

	it("throws when git extension is not found", async () => {
		vi.spyOn(vscode.extensions, "getExtension").mockReturnValue(
			undefined as any,
		);
		await expect(service.initialize()).rejects.toThrow(
			"Git extension not found",
		);
	});

	it("skips re-initialization if already initialized", async () => {
		const api = createMockGitAPI();
		setupGitExtension(api);

		await service.initialize();
		await service.initialize(); // second call
		// getExtension should only be called once
		expect(vscode.extensions.getExtension).toHaveBeenCalledTimes(1);
	});
});

// ─── GitService.isInitialized ───────────────────────────────

describe("GitService.isInitialized", () => {
	it("returns false before initialization", () => {
		const service = new GitService();
		expect(service.isInitialized()).toBe(false);
	});
});

// ─── GitService.getChanges ──────────────────────────────────

describe("GitService.getChanges", () => {
	let service: GitService;

	beforeEach(async () => {
		service = new GitService();
		vi.restoreAllMocks();
	});

	it("returns empty arrays when no changes", async () => {
		const repo = createMockRepo();
		const api = createMockGitAPI([repo]);
		setupGitExtension(api);
		await service.initialize();

		const changes = await service.getChanges();
		expect(changes.staged).toEqual([]);
		expect(changes.unstaged).toEqual([]);
	});

	it("maps status codes to correct strings", async () => {
		const repo = createMockRepo({
			state: {
				indexChanges: [
					{ uri: { fsPath: "/workspace/file1.ts" }, status: 0 },
					{ uri: { fsPath: "/workspace/file2.ts" }, status: 1 },
					{ uri: { fsPath: "/workspace/file3.ts" }, status: 2 },
				],
				workingTreeChanges: [
					{ uri: { fsPath: "/workspace/file4.ts" }, status: 3 },
					{ uri: { fsPath: "/workspace/file5.ts" }, status: 7 },
				],
			},
		});
		const api = createMockGitAPI([repo]);
		setupGitExtension(api);
		await service.initialize();

		const changes = await service.getChanges();
		expect(changes.staged).toHaveLength(3);
		expect(changes.staged[0].status).toBe("modified");
		expect(changes.staged[1].status).toBe("added");
		expect(changes.staged[2].status).toBe("deleted");
		expect(changes.unstaged[0].status).toBe("renamed");
		expect(changes.unstaged[1].status).toBe("untracked");
	});

	it("maps unknown status to 'unknown'", async () => {
		const repo = createMockRepo({
			state: {
				indexChanges: [{ uri: { fsPath: "/workspace/f.ts" }, status: 99 }],
				workingTreeChanges: [],
			},
		});
		const api = createMockGitAPI([repo]);
		setupGitExtension(api);
		await service.initialize();

		const changes = await service.getChanges();
		expect(changes.staged[0].status).toBe("unknown");
	});

	it("throws when not initialized", async () => {
		await expect(service.getChanges()).rejects.toThrow(
			"Git service not initialized",
		);
	});
});

// ─── GitService.getDiff ─────────────────────────────────────

describe("GitService.getDiff", () => {
	let service: GitService;
	let repo: any;

	beforeEach(async () => {
		service = new GitService();
		vi.restoreAllMocks();

		repo = createMockRepo();
		const api = createMockGitAPI([repo]);
		setupGitExtension(api);

		// Set workspace folder
		(vscode.workspace as any).workspaceFolders = [
			{ uri: { fsPath: "/workspace" } },
		];

		await service.initialize();
	});

	it("returns diff for relative path", async () => {
		const diff = await service.getDiff("src/file.ts");
		expect(repo.diffWithHEAD).toHaveBeenCalledWith("src/file.ts");
		expect(diff).toBe("diff output");
	});

	it("converts absolute path to relative", async () => {
		await service.getDiff("/workspace/src/file.ts");
		expect(repo.diffWithHEAD).toHaveBeenCalled();
	});

	it("returns empty string when diff fails", async () => {
		repo.diffWithHEAD.mockRejectedValue(new Error("no diff"));
		const diff = await service.getDiff("new-file.ts");
		expect(diff).toBe("");
	});

	it("throws for invalid file path", async () => {
		await expect(service.getDiff("file;rm -rf /")).rejects.toThrow(
			"Invalid file path",
		);
	});

	it("throws when no workspace folder", async () => {
		(vscode.workspace as any).workspaceFolders = [];
		await expect(service.getDiff("file.ts")).rejects.toThrow(
			"No workspace folder",
		);
	});
});

// ─── GitService.stage ───────────────────────────────────────

describe("GitService.stage", () => {
	let service: GitService;
	let repo: any;

	beforeEach(async () => {
		service = new GitService();
		vi.restoreAllMocks();

		repo = createMockRepo();
		const api = createMockGitAPI([repo]);
		setupGitExtension(api);

		(vscode.workspace as any).workspaceFolders = [
			{ uri: { fsPath: "/workspace" } },
		];

		await service.initialize();
	});

	it("stages a relative path", async () => {
		await service.stage("src/file.ts");
		expect(repo.add).toHaveBeenCalledWith(["src/file.ts"]);
	});

	it("converts absolute path to relative before staging", async () => {
		await service.stage("/workspace/src/file.ts");
		expect(repo.add).toHaveBeenCalled();
	});

	it("throws for invalid file path", async () => {
		await expect(service.stage("file|bad")).rejects.toThrow(
			"Invalid file path",
		);
	});

	it("throws when no workspace folder", async () => {
		(vscode.workspace as any).workspaceFolders = [];
		await expect(service.stage("file.ts")).rejects.toThrow(
			"No workspace folder",
		);
	});
});

// ─── GitService.stageAll ────────────────────────────────────

describe("GitService.stageAll", () => {
	let service: GitService;
	let repo: any;

	beforeEach(async () => {
		service = new GitService();
		vi.restoreAllMocks();

		repo = createMockRepo({
			state: {
				indexChanges: [],
				workingTreeChanges: [
					{ uri: { fsPath: "/workspace/a.ts" } },
					{ uri: { fsPath: "/workspace/b.ts" } },
				],
			},
		});
		const api = createMockGitAPI([repo]);
		setupGitExtension(api);
		await service.initialize();
	});

	it("stages all working tree changes", async () => {
		await service.stageAll();
		expect(repo.add).toHaveBeenCalledWith(["a.ts", "b.ts"]);
	});

	it("does nothing when no working tree changes", async () => {
		repo.state.workingTreeChanges = [];
		await service.stageAll();
		expect(repo.add).not.toHaveBeenCalled();
	});
});

// ─── GitService.discard ─────────────────────────────────────

describe("GitService.discard", () => {
	let service: GitService;
	let repo: any;

	beforeEach(async () => {
		service = new GitService();
		vi.restoreAllMocks();

		repo = createMockRepo();
		const api = createMockGitAPI([repo]);
		setupGitExtension(api);
		await service.initialize();
	});

	it("discards changes for relative path", async () => {
		await service.discard("src/file.ts");
		expect(repo.clean).toHaveBeenCalledWith(["src/file.ts"]);
	});

	it("converts absolute path to relative", async () => {
		await service.discard("/workspace/src/file.ts");
		expect(repo.clean).toHaveBeenCalled();
	});

	it("throws for invalid file path", async () => {
		await expect(service.discard("file`cmd`")).rejects.toThrow(
			"Invalid file path",
		);
	});
});

// ─── GitService.commit ──────────────────────────────────────

describe("GitService.commit", () => {
	let service: GitService;
	let repo: any;

	beforeEach(async () => {
		service = new GitService();
		vi.restoreAllMocks();

		repo = createMockRepo({
			state: {
				indexChanges: [{ uri: { fsPath: "/workspace/f.ts" }, status: 0 }],
				workingTreeChanges: [],
			},
		});
		const api = createMockGitAPI([repo]);
		setupGitExtension(api);
		await service.initialize();
	});

	it("commits with trimmed message", async () => {
		await service.commit("  fix: bug  ");
		expect(repo.commit).toHaveBeenCalledWith("fix: bug");
	});

	it("throws for empty message", async () => {
		await expect(service.commit("")).rejects.toThrow("Commit message required");
	});

	it("throws for whitespace-only message", async () => {
		await expect(service.commit("   ")).rejects.toThrow(
			"Commit message required",
		);
	});

	it("throws when nothing is staged", async () => {
		repo.state.indexChanges = [];
		await expect(service.commit("some message")).rejects.toThrow(
			"Nothing to commit",
		);
	});
});

// ─── GitService.push ────────────────────────────────────────

describe("GitService.push", () => {
	let service: GitService;
	let repo: any;

	beforeEach(async () => {
		service = new GitService();
		vi.restoreAllMocks();

		repo = createMockRepo();
		const api = createMockGitAPI([repo]);
		setupGitExtension(api);
		await service.initialize();
	});

	it("delegates to repo.push", async () => {
		await service.push();
		expect(repo.push).toHaveBeenCalled();
	});
});

// ─── GitService.getRepo (multi-root) ────────────────────────

describe("GitService getRepo multi-root", () => {
	let service: GitService;

	beforeEach(async () => {
		service = new GitService();
		vi.restoreAllMocks();
	});

	it("uses fileUri repo when provided and found", async () => {
		const repo1 = createMockRepo();
		const repo2 = createMockRepo();
		const api = createMockGitAPI([repo1, repo2]);
		api.getRepository.mockImplementation((uri: any) =>
			uri?.fsPath === "/project-a/sub/file.ts" ? repo2 : null,
		);
		setupGitExtension(api);
		await service.initialize();

		// getDiff with absolute path under workspace triggers getRepo(fileUri)
		(vscode.workspace as any).workspaceFolders = [
			{ uri: { fsPath: "/project-a" } },
		];
		await service.getDiff("/project-a/sub/file.ts");
		expect(repo2.diffWithHEAD).toHaveBeenCalled();
	});

	it("falls back to active editor repo", async () => {
		const repo1 = createMockRepo();
		const repo2 = createMockRepo();
		const api = createMockGitAPI([repo1, repo2]);
		api.getRepository.mockImplementation((uri: any) =>
			uri?.fsPath === "/editor/file.ts" ? repo2 : null,
		);
		setupGitExtension(api);
		await service.initialize();

		// Set active editor
		(vscode.window as any).activeTextEditor = {
			document: { uri: { fsPath: "/editor/file.ts" } },
		};

		const changes = await service.getChanges();
		expect(changes).toBeDefined();
	});

	it("falls back to first repository", async () => {
		const repo = createMockRepo();
		const api = createMockGitAPI([repo]);
		setupGitExtension(api);
		await service.initialize();

		(vscode.window as any).activeTextEditor = undefined;

		const changes = await service.getChanges();
		expect(changes).toBeDefined();
	});

	it("throws when no repositories available", async () => {
		const api = createMockGitAPI([]);
		setupGitExtension(api);
		await service.initialize();

		(vscode.window as any).activeTextEditor = undefined;

		await expect(service.getChanges()).rejects.toThrow("No repository found");
	});
});

// ─── GitService.unstage ─────────────────────────────────────

describe("GitService.unstage", () => {
	let service: GitService;

	beforeEach(async () => {
		service = new GitService();
		vi.restoreAllMocks();

		const repo = createMockRepo();
		const api = createMockGitAPI([repo]);
		setupGitExtension(api);

		(vscode.workspace as any).workspaceFolders = [
			{ uri: { fsPath: "/workspace" } },
		];

		await service.initialize();
	});

	it("spawns git reset HEAD for valid path", async () => {
		const { spawn } = await import("node:child_process");
		const mockProc = {
			stderr: { on: vi.fn() },
			on: vi.fn((event: string, cb: any) => {
				if (event === "close") setTimeout(() => cb(0), 0);
			}),
		};
		(spawn as any).mockReturnValue(mockProc);

		await service.unstage("src/file.ts");
		expect(spawn).toHaveBeenCalledWith(
			"git",
			["reset", "HEAD", "--", "src/file.ts"],
			{ cwd: "/workspace" },
		);
	});

	it("rejects when git reset fails", async () => {
		const { spawn } = await import("node:child_process");
		const mockProc = {
			stderr: {
				on: vi.fn((event: string, cb: any) => {
					if (event === "data") cb("fatal: error");
				}),
			},
			on: vi.fn((event: string, cb: any) => {
				if (event === "close") setTimeout(() => cb(1), 0);
			}),
		};
		(spawn as any).mockReturnValue(mockProc);

		await expect(service.unstage("file.ts")).rejects.toThrow("fatal: error");
	});

	it("rejects when spawn emits error", async () => {
		const { spawn } = await import("node:child_process");
		const mockProc = {
			stderr: { on: vi.fn() },
			on: vi.fn((event: string, cb: any) => {
				if (event === "error") setTimeout(() => cb(new Error("ENOENT")), 0);
			}),
		};
		(spawn as any).mockReturnValue(mockProc);

		await expect(service.unstage("file.ts")).rejects.toThrow("ENOENT");
	});

	it("throws for invalid file path", async () => {
		await expect(service.unstage("file;rm -rf /")).rejects.toThrow(
			"Invalid file path",
		);
	});

	it("throws when no workspace folder", async () => {
		(vscode.workspace as any).workspaceFolders = [];
		await expect(service.unstage("file.ts")).rejects.toThrow(
			"No workspace folder",
		);
	});

	it("provides default error message when stderr is empty", async () => {
		const { spawn } = await import("node:child_process");
		const mockProc = {
			stderr: { on: vi.fn() },
			on: vi.fn((event: string, cb: any) => {
				if (event === "close") setTimeout(() => cb(128), 0);
			}),
		};
		(spawn as any).mockReturnValue(mockProc);

		await expect(service.unstage("file.ts")).rejects.toThrow(
			"git reset failed with code 128",
		);
	});
});
