import * as path from "path";
import * as vscode from "vscode";

// Git extension types
interface Repository {
	state: RepositoryState;
	rootUri?: vscode.Uri;
	diffWithHEAD(path: string): Promise<string>;
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

export const GIT_READ_ONLY_MESSAGE =
	"Git write operations are disabled. Code Review is read-only.";

/**
 * Validate file paths to prevent command injection.
 * Rejects paths with shell metacharacters or attempted traversal.
 * Absolute paths are only allowed if they resolve under the workspace root.
 */
export function isValidFilePath(filePath: string): boolean {
	// Reject empty/whitespace-only paths
	if (!filePath || !filePath.trim()) return false;
	// Normalize separators so Windows-style paths are handled consistently
	const normalizedPath = filePath.replace(/\\/g, "/");
	// Reject paths with shell metacharacters (allow path separators)
	const dangerousChars = /[`$|;&<>(){}[\]!*?'"\n\r\x00]/;
	if (dangerousChars.test(normalizedPath)) return false;

	// Absolute paths must resolve under the workspace root
	if (path.isAbsolute(filePath)) {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) return false;
		const resolved = path.resolve(filePath);
		return workspaceFolders.some((folder) => {
			const root = path.resolve(folder.uri.fsPath);
			const rel = path.relative(root, resolved);
			return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
		});
	}

	// Relative paths: reject directory traversal that escapes
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
		const repoRoot = repo.rootUri?.fsPath;

		const mapChange = (c: Change): FileChange => ({
			path: this.toRepoRelativePath(repo, c.uri.fsPath, repoRoot),
			status: statusMap[c.status] || "unknown",
		});

		return {
			staged: repo.state.indexChanges.map(mapChange),
			unstaged: repo.state.workingTreeChanges.map(mapChange),
		};
	}

	/**
	 * Resolve a file path to a repo, workspace root, and validated relative path.
	 * Shared by getDiff, stage, unstage, and discard to avoid repetition.
	 */
	private resolveFilePath(filePath: string): {
		repo: Repository;
		repoRoot: string;
		relativePath: string;
	} {
		const fileUri = path.isAbsolute(filePath)
			? vscode.Uri.file(filePath)
			: undefined;
		const repo = this.getRepo(fileUri);
		const workspaceRoot = fileUri
			? vscode.workspace.getWorkspaceFolder(fileUri)?.uri.fsPath
			: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) throw new Error("No workspace folder");
		const repoRoot = repo.rootUri?.fsPath || workspaceRoot;
		const relativePath = this.toRepoRelativePath(repo, filePath, workspaceRoot);
		if (!isValidFilePath(relativePath)) throw new Error("Invalid file path");
		return { repo, repoRoot, relativePath };
	}

	/**
	 * Convert an absolute/workspace-relative path to a path relative to the repo root.
	 */
	private toRepoRelativePath(
		repo: Repository,
		filePath: string,
		workspaceRoot?: string,
	): string {
		const repoRoot = repo.rootUri?.fsPath;

		// Build an absolute candidate for relative input when possible.
		const absoluteCandidate = path.isAbsolute(filePath)
			? path.resolve(filePath)
			: workspaceRoot
				? path.resolve(workspaceRoot, filePath)
				: undefined;

		if (repoRoot && absoluteCandidate) {
			const relFromRepo = path.relative(path.resolve(repoRoot), absoluteCandidate);
			if (!relFromRepo.startsWith("..") && !path.isAbsolute(relFromRepo)) {
				return relFromRepo.replace(/\\/g, "/");
			}
		}

		if (path.isAbsolute(filePath)) {
			return vscode.workspace.asRelativePath(filePath).replace(/\\/g, "/");
		}

		if (repoRoot && workspaceRoot) {
			const relFromWorkspace = path.relative(
				path.resolve(workspaceRoot),
				path.resolve(repoRoot),
			);
			if (relFromWorkspace && !relFromWorkspace.startsWith("..")) {
				const prefix = relFromWorkspace.replace(/\\/g, "/") + "/";
				if (filePath.replace(/\\/g, "/").startsWith(prefix)) {
					return filePath.replace(/\\/g, "/").slice(prefix.length);
				}
			}
		}

		return filePath.replace(/\\/g, "/");
	}

	async getDiff(filePath: string): Promise<string> {
		const { repo, relativePath } = this.resolveFilePath(filePath);
		try {
			return await repo.diffWithHEAD(relativePath);
		} catch (err) {
			// If diff fails, return empty string (might be a new file)
			console.error("[TaskSync Git] Diff failed for", relativePath, err);
			return "";
		}
	}
}
