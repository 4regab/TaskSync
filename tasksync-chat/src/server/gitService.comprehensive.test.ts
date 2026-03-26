import * as path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "../__mocks__/vscode";
import { GitService, isValidFilePath } from "../server/gitService";

function createMockRepo(overrides: Partial<any> = {}) {
	return {
		state: {
			indexChanges: [],
			workingTreeChanges: [],
			...overrides.state,
		},
		diffWithHEAD: vi.fn().mockResolvedValue("diff output"),
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

describe("isValidFilePath edge cases", () => {
	it("rejects null-byte injection", () => {
		expect(isValidFilePath("file\x00.txt")).toBe(false);
	});

	it("accepts deeply nested valid paths", () => {
		expect(isValidFilePath("a/b/c/d/e/f/g.ts")).toBe(true);
	});

	it("allows .. in middle of path that normalizes safely", () => {
		expect(isValidFilePath("a/b/../c")).toBe(true);
	});
});

describe("GitService.initialize", () => {
	let service: GitService;

	beforeEach(() => {
		service = new GitService();
		vi.restoreAllMocks();
	});

	it("initializes successfully with active git extension", async () => {
		const repo = createMockRepo();
		const api = createMockGitAPI([repo]);
		setupGitExtension(api);

		await service.initialize();
		const changes = await service.getChanges();
		expect(changes).toEqual({ staged: [], unstaged: [] });
	});

	it("activates inactive git extension", async () => {
		const repo = createMockRepo();
		const api = createMockGitAPI([repo]);
		const ext = setupGitExtension(api, false);

		await service.initialize();
		expect(ext.activate).toHaveBeenCalled();
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
		await service.initialize();
		expect(vscode.extensions.getExtension).toHaveBeenCalledTimes(1);
	});
});

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

describe("GitService.getDiff", () => {
	let service: GitService;
	let repo: any;
	const workspaceRoot = path.resolve(process.cwd(), "workspace");

	beforeEach(async () => {
		service = new GitService();
		vi.restoreAllMocks();

		repo = createMockRepo({ rootUri: { fsPath: workspaceRoot } });
		const api = createMockGitAPI([repo]);
		setupGitExtension(api);

		(vscode.workspace as any).workspaceFolders = [
			{ uri: { fsPath: workspaceRoot } },
		];

		await service.initialize();
	});

	it("returns diff for relative path", async () => {
		const diff = await service.getDiff("src/file.ts");
		expect(repo.diffWithHEAD).toHaveBeenCalledWith("src/file.ts");
		expect(diff).toBe("diff output");
	});

	it("converts absolute path to relative", async () => {
		await service.getDiff(path.resolve(workspaceRoot, "src/file.ts"));
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
		const projectRoot = path.resolve(process.cwd(), "project-a");
		const targetPath = path.resolve(projectRoot, "sub", "file.ts");
		api.getRepository.mockImplementation((uri: any) =>
			uri?.fsPath === targetPath ? repo2 : null,
		);
		setupGitExtension(api);
		await service.initialize();

		(vscode.workspace as any).workspaceFolders = [
			{ uri: { fsPath: projectRoot } },
		];
		await service.getDiff(targetPath);
		expect(repo2.diffWithHEAD).toHaveBeenCalled();
	});

	it("resolves relative diff path to repo derived from requested path", async () => {
		const rootA = path.resolve(process.cwd(), "workspace", "root-a");
		const rootB = path.resolve(process.cwd(), "workspace", "root-b");
		const repo1 = createMockRepo({ rootUri: { fsPath: rootA } });
		const repo2 = createMockRepo({ rootUri: { fsPath: rootB } });
		const api = createMockGitAPI([repo1, repo2]);
		api.getRepository.mockImplementation((uri: any) => {
			const normalized = String(uri?.fsPath || "").replace(/\\/g, "/");
			const normalizedRootB = rootB.replace(/\\/g, "/") + "/";
			const normalizedRootA = rootA.replace(/\\/g, "/") + "/";
			if (normalized.startsWith(normalizedRootB)) return repo2;
			if (normalized.startsWith(normalizedRootA)) return repo1;
			return null;
		});
		setupGitExtension(api);
		await service.initialize();

		(vscode.workspace as any).workspaceFolders = [
			{ uri: { fsPath: rootA } },
			{ uri: { fsPath: rootB } },
		];
		(vscode.window as any).activeTextEditor = {
			document: { uri: { fsPath: path.resolve(rootA, "active.ts") } },
		};

		await service.getDiff("root-b/src/file.ts");
		expect(repo2.diffWithHEAD).toHaveBeenCalledWith("src/file.ts");
		expect(repo1.diffWithHEAD).not.toHaveBeenCalled();
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
