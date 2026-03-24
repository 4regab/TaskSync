/**
 * Remote API handlers extracted from webviewProvider.ts.
 * All public methods that the remote server calls.
 */
import * as path from "path";
import * as vscode from "vscode";

import {
	FILE_SEARCH_EXCLUSION_PATTERNS,
	formatExcludePattern,
} from "../constants/fileExclusions";
import {
	ErrorCode,
	MAX_QUEUE_PROMPT_LENGTH,
	MAX_QUEUE_SIZE,
	MAX_REMOTE_HISTORY_ITEMS,
	MAX_SEARCH_QUERY_LENGTH,
} from "../constants/remoteConstants";
import { isApprovalQuestion, parseChoices } from "./choiceParser";
import { searchToolsForAutocomplete } from "./fileHandlers";
import {
	handleClearQueue,
	handleEditQueuePrompt,
	handleRemoveQueuePrompt,
	handleReorderQueue,
	handleToggleQueue,
} from "./queueHandlers";
import * as settingsH from "./settingsHandlers";
import type {
	AttachmentInfo,
	FileSearchResult,
	P,
	UserResponseResult,
} from "./webviewTypes";
import {
	broadcastToolCallCompleted,
	debugLog,
	generateId,
	getFileIcon,
	hasQueuedItems,
	notifyQueueChanged,
} from "./webviewUtils";

/**
 * Get current state for remote clients.
 */
export function getRemoteState(p: P): {
	pending: {
		id: string;
		prompt: string;
		summary?: string;
		choices?: Array<{ label: string; value: string; shortLabel?: string }>;
		isApproval: boolean;
		timestamp: number;
	} | null;
	queue: Array<{ id: string; prompt: string; attachments: AttachmentInfo[] }>;
	queueVersion: number;
	history: Array<{
		id: string;
		prompt: string;
		summary?: string;
		response: string;
		timestamp: number;
		status: "pending" | "completed" | "cancelled";
		isFromQueue: boolean;
		attachments: AttachmentInfo[];
	}>;
	settings: ReturnType<typeof settingsH.buildSettingsPayload>;
	session: { startTime: number | null; toolCallCount: number };
	isProcessing: boolean;
	model: string;
} {
	const pendingEntry = p._currentToolCallId
		? p._currentSessionCallsMap.get(p._currentToolCallId)
		: null;

	const result = {
		pending:
			pendingEntry && pendingEntry.status === "pending"
				? {
						id: pendingEntry.id,
						prompt: pendingEntry.prompt,
						summary: pendingEntry.summary,
						choices: parseChoices(pendingEntry.prompt).map((c) => ({
							label: c.label,
							value: c.value,
							shortLabel: c.shortLabel,
						})),
						isApproval: isApprovalQuestion(pendingEntry.prompt),
						timestamp: pendingEntry.timestamp,
					}
				: null,
		queue: p._promptQueue.map(
			(q: { id: string; prompt: string; attachments?: AttachmentInfo[] }) => ({
				id: q.id,
				prompt: q.prompt,
				attachments: q.attachments || [],
			}),
		),
		queueVersion: p._queueVersion,
		history: p._currentSessionCalls
			.slice(0, MAX_REMOTE_HISTORY_ITEMS)
			.map(
				(c: {
					id: string;
					prompt: string;
					summary?: string;
					response: string;
					timestamp: number;
					status: "pending" | "completed" | "cancelled";
					isFromQueue: boolean;
					attachments?: AttachmentInfo[];
				}) => ({
					id: c.id,
					prompt: c.prompt,
					summary: c.summary,
					response: c.response,
					timestamp: c.timestamp,
					status: c.status,
					isFromQueue: c.isFromQueue,
					attachments: c.attachments || [],
				}),
			),
		settings: settingsH.buildSettingsPayload(p),
		session: {
			startTime: p._sessionStartTime,
			toolCallCount: p._currentSessionCalls.length,
		},
		// True when AI is actively working (between user response and next askUser call)
		isProcessing: p._aiTurnActive,
		model: p._lastKnownModel,
	};

	debugLog(
		"[TaskSync] getRemoteState — aiTurnActive:",
		p._aiTurnActive,
		"currentToolCallId:",
		p._currentToolCallId,
		"pendingRequests:",
		p._pendingRequests.size,
		"=> isProcessing:",
		result.isProcessing,
		"pending:",
		!!result.pending,
	);

	return result;
}

/**
 * Resolve a response from a remote client.
 * Returns false if the tool call was already answered (no pending resolver found).
 */
export function resolveRemoteResponse(
	p: P,
	toolCallId: string,
	value: string,
	attachments: AttachmentInfo[],
): boolean {
	const resolver = p._pendingRequests.get(toolCallId);
	if (!resolver) {
		debugLog(
			"[TaskSync] resolveRemoteResponse — no pending resolver for:",
			toolCallId,
		);
		return false;
	}
	debugLog(
		"[TaskSync] resolveRemoteResponse — resolving toolCallId:",
		toolCallId,
		"response:",
		value.slice(0, 80),
		"attachments:",
		attachments.length,
	);
	p._pendingRequests.delete(toolCallId);

	// Reset consecutive auto-responses counter — remote manual response is human interaction
	p._consecutiveAutoResponses = 0;

	if (p._responseTimeoutTimer) {
		clearTimeout(p._responseTimeoutTimer);
		p._responseTimeoutTimer = null;
	}

	resolver({
		value,
		attachments,
		queue: hasQueuedItems(p),
	} as UserResponseResult);

	const entry = p._currentSessionCallsMap.get(toolCallId);
	if (entry) {
		entry.response = value;
		entry.status = "completed";
		entry.attachments = attachments;
		entry.timestamp = Date.now();
	}

	p._currentToolCallId = null;
	p._aiTurnActive = true; // AI is now processing the response
	debugLog(`[TaskSync] resolveRemoteResponse — resolved, aiTurnActive: true`);
	p._updateCurrentSessionUI();

	if (entry) {
		broadcastToolCallCompleted(p, entry);
	}
	return true;
}

/**
 * Cancel currently pending tool call (if any) and resolve waiting promise.
 */
export function cancelPendingToolCall(
	p: P,
	reason = "[Cancelled by user]",
): boolean {
	const toolCallId = p._currentToolCallId;
	if (!toolCallId) return false;

	const resolver = p._pendingRequests.get(toolCallId);
	if (!resolver) return false;

	debugLog(
		"[TaskSync] cancelPendingToolCall — toolCallId:",
		toolCallId,
		"reason:",
		reason,
	);
	p._pendingRequests.delete(toolCallId);
	if (p._responseTimeoutTimer) {
		clearTimeout(p._responseTimeoutTimer);
		p._responseTimeoutTimer = null;
	}

	const entry = p._currentSessionCallsMap.get(toolCallId);
	if (entry) {
		entry.response = reason;
		entry.status = "cancelled";
		entry.timestamp = Date.now();
		entry.attachments = [];
	}

	resolver({
		value: reason,
		attachments: [],
		queue: hasQueuedItems(p),
		cancelled: true,
	} as UserResponseResult);

	p._currentToolCallId = null;
	p._aiTurnActive = true; // AI will process the cancellation
	debugLog(`[TaskSync] cancelPendingToolCall — cancelled, aiTurnActive: true`);
	p._updateCurrentSessionUI();

	if (entry) {
		broadcastToolCallCompleted(p, entry);
	}
	return true;
}

/**
 * Add to queue from a remote client.
 */
export function addToQueueFromRemote(
	p: P,
	prompt: string,
	attachments: AttachmentInfo[],
): { error?: string; code?: string } {
	const trimmed = (prompt || "").trim();
	debugLog(
		`[TaskSync] addToQueueFromRemote — prompt: "${trimmed.slice(0, 60)}", attachments: ${attachments.length}, queueSize: ${p._promptQueue.length}`,
	);
	if (!trimmed || trimmed.length > MAX_QUEUE_PROMPT_LENGTH) {
		return { error: "Invalid prompt length", code: ErrorCode.INVALID_INPUT };
	}

	if (p._promptQueue.length >= MAX_QUEUE_SIZE) {
		return { error: "Queue is full", code: ErrorCode.QUEUE_FULL };
	}

	const id = generateId("q");
	p._promptQueue.push({ id, prompt: trimmed, attachments });
	notifyQueueChanged(p);
	return {};
}

/**
 * Remove from queue by ID.
 */
export function removeFromQueueById(p: P, id: string): void {
	handleRemoveQueuePrompt(p, id);
}

/**
 * Edit a queue prompt from remote client.
 */
export function editQueuePromptFromRemote(
	p: P,
	promptId: string,
	newPrompt: string,
): { error?: string; code?: string } {
	const prompt = p._promptQueue.find(
		(item: { id: string }) => item.id === promptId,
	);
	if (!prompt) {
		return {
			error: "This queue item no longer exists.",
			code: ErrorCode.ITEM_NOT_FOUND,
		};
	}
	handleEditQueuePrompt(p, promptId, newPrompt);
	return {};
}

/**
 * Reorder queue from remote client.
 */
export function reorderQueueFromRemote(
	p: P,
	fromIndex: number,
	toIndex: number,
): void {
	handleReorderQueue(p, fromIndex, toIndex);
}

/**
 * Clear queue from remote client.
 */
export function clearQueueFromRemote(p: P): void {
	handleClearQueue(p);
}

/**
 * Set autopilot enabled/disabled from remote.
 */
export async function setAutopilotEnabled(
	p: P,
	enabled: boolean,
): Promise<void> {
	await settingsH.handleUpdateAutopilotSetting(p, enabled);
	p._updateSettingsUI();
}

/**
 * Search workspace files and tools for remote client.
 * Uses a glob pattern incorporating the query to avoid loading all workspace files.
 */
export async function searchFilesForRemote(
	p: P,
	query: string,
): Promise<FileSearchResult[]> {
	const queryLower = (query || "").toLowerCase();

	// Tool results (LM tools matching query — works with empty query too)
	const toolResults = searchToolsForAutocomplete(query || "");

	// File search requires at least 2 chars to avoid loading entire workspace
	if (!query || query.length < 2 || query.length > MAX_SEARCH_QUERY_LENGTH) {
		return toolResults;
	}

	// Escape glob special characters in the query for safe pattern matching
	const safeQuery = query.replace(/[[\]{}()*?!\\]/g, "\\$&");
	const excludePattern = formatExcludePattern(FILE_SEARCH_EXCLUSION_PATTERNS);
	// Use glob pattern to narrow results at the VS Code API level
	const matchingFiles = await vscode.workspace.findFiles(
		`**/*${safeQuery}*`,
		excludePattern,
		50,
	);

	const fileResults = matchingFiles
		.map((uri: vscode.Uri) => {
			const relativePath = vscode.workspace.asRelativePath(uri);
			const fileName = path.basename(uri.fsPath);
			return {
				name: fileName,
				path: relativePath,
				uri: uri.toString(),
				icon: getFileIcon(fileName),
				isFolder: false,
			};
		})
		.filter(
			(file: FileSearchResult) =>
				file.name.toLowerCase().includes(queryLower) ||
				file.path.toLowerCase().includes(queryLower),
		);

	return [...toolResults, ...fileResults];
}

/**
 * Set queue enabled/disabled from remote.
 */
export function setQueueEnabled(p: P, enabled: boolean): void {
	handleToggleQueue(p, enabled);
}

/**
 * Set response timeout from remote client.
 */
export async function setResponseTimeoutFromRemote(
	p: P,
	timeout: number,
): Promise<void> {
	await settingsH.handleUpdateResponseTimeout(p, timeout);
	// VS Code webview + remote broadcast handled by onDidChangeConfiguration
}
