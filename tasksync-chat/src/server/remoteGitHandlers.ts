import type { WebSocket } from "ws";
import {
	ErrorCode,
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
	_broadcast: BroadcastFn,
	searchFn: (query: string) => Promise<unknown[]>,
	msg: { type: string; [key: string]: unknown },
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
