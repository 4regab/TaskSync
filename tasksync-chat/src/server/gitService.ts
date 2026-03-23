import * as path from "path";
import * as vscode from "vscode";

// Git extension types
interface Repository {
	state: RepositoryState;
	diffWithHEAD(path: string): Promise<string>;
	add(paths: string[]): Promise<void>;
	clean(paths: string[]): Promise<void>;
	commit(message: string): Promise<void>;
	push(): Promise<void>;
}

interface RepositoryState {
	indexChanges: Change[];
	workingTreeChanges: Change[];
}

interface Change {
	uri: vscode.Uri;
	status: number;
}

interface GitAPI {
	repositories: Repository[];
	getRepository(uri: vscode.Uri): Repository | null;
}

interface GitExtension {
	getAPI(version: 1): GitAPI;
}

export interface FileChange {
	path: string;
	status: string;
}

export interface GitChanges {
	staged: FileChange[];
	unstaged: FileChange[];
}

/**
 * Validate file paths to prevent command injection.
 * Rejects paths with shell metacharacters or attempted traversal.
 */
export function isValidFilePath(filePath: string): boolean {
	// Reject empty/whitespace-only paths
	if (!filePath || !filePath.trim()) return false;
	// Normalize separators so Windows-style paths are handled consistently
	const normalizedPath = filePath.replace(/\\/g, "/");
	// Reject paths with shell metacharacters (allow path separators)
	const dangerousChars = /[`$|;&<>(){}[\]!*?'"\n\r\x00]/;
	if (dangerousChars.test(normalizedPath)) return false;
	// Reject absolute paths that escape workspace
	if (normalizedPath.includes("..")) {
		const normalized = path.normalize(normalizedPath);
		if (normalized.startsWith("..")) return false;
	}
	return true;
}

export class GitService {
	private api: GitAPI | null = null;
	private initialized: boolean = false;

	async initialize(): Promise<void> {
		if (this.initialized) return;

		const gitExt = vscode.extensions.getExtension<GitExtension>("vscode.git");
		if (!gitExt) {
			throw new Error("Git extension not found");
		}

		if (!gitExt.isActive) {
			await gitExt.activate();
		}

		this.api = gitExt.exports.getAPI(1);
		this.initialized = true;
	}

	isInitialized(): boolean {
		return this.initialized && this.api !== null;
	}

	private getRepo(fileUri?: vscode.Uri): Repository {
		if (!this.api) {
			throw new Error("Git service not initialized");
		}
		// In multi-root workspaces, find the repo for the given file
		if (fileUri) {
			const repo = this.api.getRepository(fileUri);
			if (repo) return repo;
		}
		// Fall back to active editor's repo, then first repo
		const activeUri = vscode.window.activeTextEditor?.document.uri;
		if (activeUri) {
			const repo = this.api.getRepository(activeUri);
			if (repo) return repo;
		}
		if (!this.api.repositories[0]) {
			throw new Error("No repository found");
		}
		return this.api.repositories[0];
	}

	async getChanges(): Promise<GitChanges> {
		const repo = this.getRepo();
		const statusMap = [
			"modified", // 0
			"added", // 1
			"deleted", // 2
			"renamed", // 3
			"copied", // 4
			"modified", // 5
			"deleted", // 6
			"untracked", // 7
		];

		const mapChange = (c: Change): FileChange => ({
			path: vscode.workspace.asRelativePath(c.uri),
			status: statusMap[c.status] || "unknown",
		});

		return {
			staged: repo.state.indexChanges.map(mapChange),
			unstaged: repo.state.workingTreeChanges.map(mapChange),
		};
	}

	async getDiff(filePath: string): Promise<string> {
		const fileUri = filePath.startsWith("/")
			? vscode.Uri.file(filePath)
			: undefined;
		const repo = this.getRepo(fileUri);

		// Find workspace root to resolve relative path
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) {
			throw new Error("No workspace folder");
		}

		// diffWithHEAD expects relative path
		const relativePath = filePath.startsWith("/")
			? vscode.workspace.asRelativePath(filePath)
			: filePath;

		// Validate path
		if (!isValidFilePath(relativePath)) {
			throw new Error("Invalid file path");
		}

		try {
			return await repo.diffWithHEAD(relativePath);
		} catch (err) {
			// If diff fails, return empty string (might be a new file)
			console.error("[TaskSync Git] Diff failed for", relativePath, err);
			return "";
		}
	}

	async stage(filePath: string): Promise<void> {
		const fileUri = filePath.startsWith("/")
			? vscode.Uri.file(filePath)
			: undefined;
		const repo = this.getRepo(fileUri);
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) throw new Error("No workspace folder");

		// Git add expects relative paths
		const relativePath = filePath.startsWith("/")
			? vscode.workspace.asRelativePath(filePath)
			: filePath;

		// Validate path
		if (!isValidFilePath(relativePath)) {
			throw new Error("Invalid file path");
		}

		await repo.add([relativePath]);
	}

	async stageAll(): Promise<void> {
		const repo = this.getRepo();
		const paths = repo.state.workingTreeChanges.map((c) =>
			vscode.workspace.asRelativePath(c.uri),
		);
		if (paths.length > 0) {
			await repo.add(paths);
		}
	}

	async unstage(filePath: string): Promise<void> {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) throw new Error("No workspace folder");

		const relativePath = filePath.startsWith("/")
			? vscode.workspace.asRelativePath(filePath)
			: filePath;

		// Validate path to prevent any malicious input
		if (!isValidFilePath(relativePath)) {
			throw new Error("Invalid file path");
		}

		// Use spawn with arguments array to completely avoid shell injection
		const { spawn } = await import("node:child_process");
		await new Promise<void>((resolve, reject) => {
			const proc = spawn("git", ["reset", "HEAD", "--", relativePath], {
				cwd: workspaceRoot,
			});
			let stderr = "";
			proc.stderr.on("data", (data) => {
				stderr += data;
			});
			proc.on("close", (code) => {
				if (code === 0) resolve();
				else reject(new Error(stderr || `git reset failed with code ${code}`));
			});
			proc.on("error", reject);
		});
	}

	async discard(filePath: string): Promise<void> {
		const fileUri = filePath.startsWith("/")
			? vscode.Uri.file(filePath)
			: undefined;
		const repo = this.getRepo(fileUri);
		const relativePath = filePath.startsWith("/")
			? vscode.workspace.asRelativePath(filePath)
			: filePath;

		// Validate path
		if (!isValidFilePath(relativePath)) {
			throw new Error("Invalid file path");
		}

		await repo.clean([relativePath]);
	}

	async commit(message: string): Promise<void> {
		if (!message || !message.trim()) {
			throw new Error("Commit message required");
		}

		const repo = this.getRepo();

		// Check if there are staged changes
		if (repo.state.indexChanges.length === 0) {
			throw new Error("Nothing to commit");
		}

		await repo.commit(message.trim());
	}

	async push(): Promise<void> {
		const repo = this.getRepo();
		await repo.push();
	}
}
