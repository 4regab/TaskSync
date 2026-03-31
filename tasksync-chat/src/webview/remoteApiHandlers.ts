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
	notifyQueueChanged,
	sessionHasQueuedItems,
} from "./webviewUtils";

/** Lightweight session summary for remote session list rendering. */
export interface RemoteSessionSummary {
	id: string;
	title: string;
	status: "active" | "archived";
	waitingOnUser: boolean;
	createdAt: number;
	/** First history entry only (for preview snippet). */
	history: Array<{ prompt: string }>;
}

/** Build lightweight session summaries for remote clients. */
export function getRemoteSessionSummaries(p: P): RemoteSessionSummary[] {
	return p._sessionManager.getAllSessions().map((s) => ({
		id: s.id,
		title: s.title,
		status: s.status,
		waitingOnUser: s.waitingOnUser,
		createdAt: s.createdAt,
		history:
			s.history.length > 0
				? [{ prompt: s.history[0].prompt.slice(0, 200) }]
				: [],
	}));
}

/**
 * Get current state for remote clients.
 */
export function getRemoteState(p: P): {
	pending: {
		id: string;
		sessionId: string;
		prompt: string;
		choices?: Array<{ label: string; value: string; shortLabel?: string }>;
		isApproval: boolean;
		timestamp: number;
	} | null;
	queue: Array<{ id: string; prompt: string; attachments: AttachmentInfo[] }>;
	queueVersion: number;
	history: Array<{
		id: string;
		prompt: string;
		response: string;
		timestamp: number;
		status: "pending" | "completed" | "cancelled";
		isFromQueue: boolean;
		attachments: AttachmentInfo[];
	}>;
	settings: ReturnType<typeof settingsH.buildSettingsPayload>;
	session: {
		startTime: number | null;
		frozenElapsed: number | null;
		toolCallCount: number;
	};
	isProcessing: boolean;
	model: string;
	sessions: RemoteSessionSummary[];
	activeSessionId: string | null;
} {
	const pendingEntry = p._currentToolCallId
		? p._currentSessionCallsMap.get(p._currentToolCallId)
		: null;

	const result = {
		pending:
			pendingEntry && pendingEntry.status === "pending"
				? {
						id: pendingEntry.id,
						sessionId:
							pendingEntry.sessionId ??
							p._sessionManager.getActiveSessionId() ??
							"",
						prompt: pendingEntry.prompt,
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
					response: string;
					timestamp: number;
					status: "pending" | "completed" | "cancelled";
					isFromQueue: boolean;
					attachments?: AttachmentInfo[];
				}) => ({
					id: c.id,
					prompt: c.prompt,
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
			frozenElapsed: p._sessionFrozenElapsed,
			toolCallCount: p._currentSessionCalls.length,
		},
		// True when AI is actively working (between user response and next askUser call)
		isProcessing: p._aiTurnActive,
		model: p._lastKnownModel,
		sessions: getRemoteSessionSummaries(p),
		activeSessionId: p._sessionManager.getActiveSessionId(),
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
	sessionId: string,
	toolCallId: string,
	value: string,
	attachments: AttachmentInfo[],
): boolean {
	const session = p._getSession(sessionId);
	if (!session || session.pendingToolCallId !== toolCallId) {
		debugLog(
			"[TaskSync] resolveRemoteResponse — session/toolCall mismatch:",
			sessionId,
			toolCallId,
		);
		return false;
	}
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
	p._toolCallSessionMap.delete(toolCallId);

	// Reset consecutive auto-responses counter — remote manual response is human interaction
	session.consecutiveAutoResponses = 0;
	p._clearResponseTimeoutTimer(toolCallId);

	resolver({
		value,
		attachments,
		queue: sessionHasQueuedItems(session),
	} as UserResponseResult);

	const entry = p._currentSessionCallsMap.get(toolCallId);
	if (entry) {
		entry.response = settingsH.applyAutoAppendToResponse(p, value, session);
		entry.status = "completed";
		entry.attachments = attachments;
		entry.timestamp = Date.now();
	}

	session.pendingToolCallId = null;
	session.waitingOnUser = false;
	session.aiTurnActive = true;
	debugLog(
		`[TaskSync] resolveRemoteResponse — resolved for session ${session.id}, aiTurnActive: true`,
	);
	if (p._sessionManager.getActiveSessionId() === session.id) {
		p._syncActiveSessionState();
	} else {
		p._updateSessionsUI();
	}
	p._saveSessionsToDisk();

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
	sessionId?: string,
): boolean {
	const session =
		(sessionId
			? p._getSession?.(sessionId)
			: p._sessionManager?.getActiveSession?.()) ?? undefined;
	// When a specific sessionId is provided, only cancel that session's tool call —
	// never fall back to the active session's _currentToolCallId (cross-session leak).
	const toolCallId = sessionId
		? (session?.pendingToolCallId ?? null)
		: (session?.pendingToolCallId ?? p._currentToolCallId ?? null);
	if (!toolCallId) return false;

	const resolver = p._pendingRequests.get(toolCallId);
	debugLog(
		"[TaskSync] cancelPendingToolCall — toolCallId:",
		toolCallId,
		"reason:",
		reason,
	);
	p._pendingRequests.delete(toolCallId);
	p._toolCallSessionMap.delete(toolCallId);
	p._clearResponseTimeoutTimer?.(toolCallId);

	const entry = p._currentSessionCallsMap.get(toolCallId);
	if (entry) {
		entry.response = reason;
		entry.status = "cancelled";
		entry.timestamp = Date.now();
		entry.attachments = [];
	}

	if (session) {
		session.pendingToolCallId = null;
		session.waitingOnUser = false;
		session.aiTurnActive = false;
	} else {
		p._currentToolCallId = null;
		p._aiTurnActive = false;
	}
	debugLog(
		`[TaskSync] cancelPendingToolCall — cancelled, session: ${session?.id ?? "unknown"}, aiTurnActive: false`,
	);
	if (resolver) {
		resolver({
			value: reason,
			attachments: [],
			queue: session ? sessionHasQueuedItems(session) : false,
			cancelled: true,
		} as UserResponseResult);
	} else {
		debugLog(
			"[TaskSync] cancelPendingToolCall — missing resolver for toolCallId:",
			toolCallId,
		);
	}
	if (session && p._sessionManager?.getActiveSessionId?.() === session.id) {
		p._syncActiveSessionState?.();
	} else {
		p._updateSessionsUI();
	}
	p._saveSessionsToDisk?.();

	if (entry) {
		broadcastToolCallCompleted(p, entry);
	}
	return Boolean(resolver || entry);
}

/**
 * Add to queue from a remote client.
 */
export function addToQueueFromRemote(
	p: P,
	prompt: string,
	attachments: AttachmentInfo[],
): { error?: string; code?: string } {
	const activeSession = p._sessionManager.getActiveSession();
	const trimmed = (prompt || "").trim();
	debugLog(
		`[TaskSync] addToQueueFromRemote — prompt: "${trimmed.slice(0, 60)}", attachments: ${attachments.length}, queueSize: ${activeSession?.queue.length ?? 0}`,
	);
	if (!activeSession) {
		return {
			error: "Open a conversation before queueing a prompt.",
			code: ErrorCode.INVALID_INPUT,
		};
	}
	if (!trimmed || trimmed.length > MAX_QUEUE_PROMPT_LENGTH) {
		return { error: "Invalid prompt length", code: ErrorCode.INVALID_INPUT };
	}

	if (activeSession.queue.length >= MAX_QUEUE_SIZE) {
		return { error: "Queue is full", code: ErrorCode.QUEUE_FULL };
	}

	const id = generateId("q");
	activeSession.queue.push({ id, prompt: trimmed, attachments });
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
	const activeSession = p._sessionManager.getActiveSession();
	if (!activeSession) {
		return {
			error: "Open a conversation before editing its queue.",
			code: ErrorCode.INVALID_INPUT,
		};
	}
	const prompt = activeSession.queue.find(
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
	_p: P,
	query: string,
): Promise<FileSearchResult[]> {
	const queryLower = (query || "").toLowerCase();

	// Tool results (LM tools matching query — works with empty query too)
	const toolResults = searchToolsForAutocomplete(query || "");

	// File search requires at least 2 chars to avoid loading entire workspace
	if (!query || query.length < 2) {
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
