import type { WebSocket } from "ws";
import {
	ErrorCode,
	MAX_COMMIT_MESSAGE_LENGTH,
	MAX_FILE_PATH_LENGTH,
	MAX_SEARCH_QUERY_LENGTH,
	truncateDiff,
} from "../constants/remoteConstants";
import type { GitService } from "./gitService";
import { GIT_READ_ONLY_MESSAGE, isValidFilePath } from "./gitService";
import { getSafeErrorMessage, sendWsError } from "./serverUtils";

/**
 * Broadcast function type for notifying all connected clients.
 */
type BroadcastFn = (type: string, data: unknown) => void;

/**
 * Guard: send GIT_UNAVAILABLE error if git is not available.
 * Returns true if git IS available, false (and sends error) if not.
 */
function requireGitService(ws: WebSocket, available: boolean): boolean {
	if (!available) {
		sendWsError(ws, "Git service is not available", ErrorCode.GIT_UNAVAILABLE);
	}
	return available;
}

/**
 * Handle getChanges request - returns list of modified files.
 */
export async function handleGetChanges(
	ws: WebSocket,
	gitService: GitService,
	gitServiceAvailable: boolean,
): Promise<void> {
	if (!requireGitService(ws, gitServiceAvailable)) return;
	try {
		const changes = await gitService.getChanges();
		ws.send(JSON.stringify({ type: "changes", data: changes }));
	} catch (err) {
		console.error(
			"[TaskSync Remote] getChanges error:",
			getSafeErrorMessage(err),
		);
		sendWsError(ws, "Failed to get changes");
	}
}

/**
 * Handle getDiff request - returns diff for a specific file.
 */
export async function handleGetDiff(
	ws: WebSocket,
	gitService: GitService,
	gitServiceAvailable: boolean,
	filePath: string,
): Promise<void> {
	if (!requireGitService(ws, gitServiceAvailable)) return;
	try {
		const diff = truncateDiff(await gitService.getDiff(filePath));
		ws.send(JSON.stringify({ type: "diff", file: filePath, data: diff }));
	} catch (err) {
		console.error("[TaskSync Remote] getDiff error:", getSafeErrorMessage(err));
		sendWsError(ws, "Failed to get diff");
	}
}

/**
 * Handle stageFile request - stages a file and broadcasts update.
 */
export async function handleStageFile(
	ws: WebSocket,
	gitService: GitService,
	gitServiceAvailable: boolean,
	broadcast: BroadcastFn,
	filePath: string,
): Promise<void> {
	if (!requireGitService(ws, gitServiceAvailable)) return;
	try {
		await gitService.stage(filePath);
		const changes = await gitService.getChanges();
		broadcast("changesUpdated", changes);
		ws.send(JSON.stringify({ type: "staged", file: filePath }));
	} catch (err) {
		console.error(
			"[TaskSync Remote] stageFile error:",
			getSafeErrorMessage(err),
		);
		sendWsError(ws, "Failed to stage file");
	}
}

/**
 * Handle unstageFile request - unstages a file and broadcasts update.
 */
export async function handleUnstageFile(
	ws: WebSocket,
	gitService: GitService,
	gitServiceAvailable: boolean,
	broadcast: BroadcastFn,
	filePath: string,
): Promise<void> {
	if (!requireGitService(ws, gitServiceAvailable)) return;
	try {
		await gitService.unstage(filePath);
		const changes = await gitService.getChanges();
		broadcast("changesUpdated", changes);
		ws.send(JSON.stringify({ type: "unstaged", file: filePath }));
	} catch (err) {
		console.error(
			"[TaskSync Remote] unstageFile error:",
			getSafeErrorMessage(err),
		);
		sendWsError(ws, "Failed to unstage file");
	}
}

/**
 * Handle stageAll request - stages all files and broadcasts update.
 */
export async function handleStageAll(
	ws: WebSocket,
	gitService: GitService,
	gitServiceAvailable: boolean,
	broadcast: BroadcastFn,
): Promise<void> {
	if (!requireGitService(ws, gitServiceAvailable)) return;
	try {
		await gitService.stageAll();
		const changes = await gitService.getChanges();
		broadcast("changesUpdated", changes);
		ws.send(JSON.stringify({ type: "stagedAll" }));
	} catch (err) {
		console.error(
			"[TaskSync Remote] stageAll error:",
			getSafeErrorMessage(err),
		);
		sendWsError(ws, "Failed to stage files");
	}
}

/**
 * Handle discardFile request - discards changes to a file and broadcasts update.
 */
export async function handleDiscardFile(
	ws: WebSocket,
	gitService: GitService,
	gitServiceAvailable: boolean,
	broadcast: BroadcastFn,
	filePath: string,
): Promise<void> {
	if (!requireGitService(ws, gitServiceAvailable)) return;
	try {
		await gitService.discard(filePath);
		const changes = await gitService.getChanges();
		broadcast("changesUpdated", changes);
		ws.send(JSON.stringify({ type: "discarded", file: filePath }));
	} catch (err) {
		console.error(
			"[TaskSync Remote] discardFile error:",
			getSafeErrorMessage(err),
		);
		sendWsError(ws, "Failed to discard changes");
	}
}

/**
 * Handle commit request - commits staged changes and broadcasts update.
 */
export async function handleCommit(
	ws: WebSocket,
	gitService: GitService,
	gitServiceAvailable: boolean,
	broadcast: BroadcastFn,
	message: string,
): Promise<void> {
	if (!requireGitService(ws, gitServiceAvailable)) return;
	// Validate commit message
	const trimmed = (message || "").trim();
	if (!trimmed || trimmed.length > MAX_COMMIT_MESSAGE_LENGTH) {
		sendWsError(ws, "Invalid commit message", ErrorCode.INVALID_INPUT);
		return;
	}
	try {
		await gitService.commit(trimmed);
		const changes = await gitService.getChanges();
		broadcast("changesUpdated", changes);
		ws.send(JSON.stringify({ type: "committed" }));
	} catch (err) {
		console.error("[TaskSync Remote] commit error:", getSafeErrorMessage(err));
		sendWsError(ws, "Failed to commit");
	}
}

/**
 * Handle push request - pushes commits to remote.
 */
export async function handlePush(
	ws: WebSocket,
	gitService: GitService,
	gitServiceAvailable: boolean,
): Promise<void> {
	if (!requireGitService(ws, gitServiceAvailable)) return;
	try {
		await gitService.push();
		ws.send(JSON.stringify({ type: "pushed" }));
	} catch (err) {
		console.error("[TaskSync Remote] push error:", getSafeErrorMessage(err));
		sendWsError(ws, "Failed to push");
	}
}

/**
 * Handle searchFiles request - searches workspace files.
 */
export async function handleSearchFiles(
	ws: WebSocket,
	searchFn: (query: string) => Promise<unknown[]>,
	query: string,
): Promise<void> {
	// Validate query length (allow empty for tool listing)
	if (query && query.length > MAX_SEARCH_QUERY_LENGTH) {
		ws.send(JSON.stringify({ type: "fileSearchResults", files: [] }));
		return;
	}
	try {
		const files = await searchFn(query);
		ws.send(JSON.stringify({ type: "fileSearchResults", files }));
	} catch (err) {
		console.error(
			"[TaskSync Remote] searchFiles error:",
			getSafeErrorMessage(err),
		);
		sendWsError(ws, "File search failed");
	}
}

/**
 * Validate a file path from a remote message.
 */
function validateFilePath(ws: WebSocket, filePath: unknown): string | null {
	if (
		typeof filePath !== "string" ||
		!filePath ||
		filePath.length > MAX_FILE_PATH_LENGTH
	) {
		sendWsError(ws, "Invalid file path", ErrorCode.INVALID_INPUT);
		return null;
	}
	if (!isValidFilePath(filePath)) {
		sendWsError(ws, "Invalid file path", ErrorCode.INVALID_INPUT);
		return null;
	}
	return filePath;
}

/**
 * Dispatch a git-related WebSocket message to the appropriate handler.
 * Returns true if the message type was handled, false otherwise.
 */
export async function dispatchGitMessage(
	ws: WebSocket,
	gitService: GitService,
	gitServiceAvailable: boolean,
	broadcast: BroadcastFn,
	searchFn: (query: string) => Promise<unknown[]>,
	msg: { type: string;[key: string]: unknown },
): Promise<boolean> {
	const isWriteType =
		msg.type === "stageFile" ||
		msg.type === "unstageFile" ||
		msg.type === "stageAll" ||
		msg.type === "discardFile" ||
		msg.type === "commitChanges" ||
		msg.type === "pushChanges";

	if (isWriteType) {
		sendWsError(ws, GIT_READ_ONLY_MESSAGE, ErrorCode.INVALID_INPUT);
		return true;
	}

	switch (msg.type) {
		case "getChanges":
			await handleGetChanges(ws, gitService, gitServiceAvailable);
			return true;
		case "getDiff": {
			const file = validateFilePath(ws, msg.file);
			if (!file) return true;
			await handleGetDiff(ws, gitService, gitServiceAvailable, file);
			return true;
		}
		case "stageFile": {
			const file = validateFilePath(ws, msg.file);
			if (!file) return true;
			await handleStageFile(
				ws,
				gitService,
				gitServiceAvailable,
				broadcast,
				file,
			);
			return true;
		}
		case "unstageFile": {
			const file = validateFilePath(ws, msg.file);
			if (!file) return true;
			await handleUnstageFile(
				ws,
				gitService,
				gitServiceAvailable,
				broadcast,
				file,
			);
			return true;
		}
		case "stageAll":
			await handleStageAll(ws, gitService, gitServiceAvailable, broadcast);
			return true;
		case "discardFile": {
			const file = validateFilePath(ws, msg.file);
			if (!file) return true;
			await handleDiscardFile(
				ws,
				gitService,
				gitServiceAvailable,
				broadcast,
				file,
			);
			return true;
		}
		case "commitChanges":
			await handleCommit(
				ws,
				gitService,
				gitServiceAvailable,
				broadcast,
				typeof msg.message === "string" ? msg.message : "",
			);
			return true;
		case "pushChanges":
			await handlePush(ws, gitService, gitServiceAvailable);
			return true;
		case "searchFiles":
			await handleSearchFiles(
				ws,
				searchFn,
				typeof msg.query === "string" ? msg.query : "",
			);
			return true;
		default:
			return false;
	}
}
