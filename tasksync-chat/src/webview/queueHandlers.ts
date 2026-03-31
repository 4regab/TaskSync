import {
	isValidQueueId,
	MAX_QUEUE_PROMPT_LENGTH,
	MAX_QUEUE_SIZE,
} from "../constants/remoteConstants";
import * as settingsH from "./settingsHandlers";
import type {
	AttachmentInfo,
	P,
	QueuedPrompt,
	ToolCallEntry,
	ToWebviewMessage,
} from "./webviewTypes";
import {
	broadcastToolCallCompleted,
	debugLog,
	generateId,
	notifyQueueChanged,
	sessionHasQueuedItems,
} from "./webviewUtils";

/**
 * Handle adding a prompt to queue.
 */
export function handleAddQueuePrompt(
	p: P,
	prompt: string,
	id: string,
	attachments: AttachmentInfo[],
): void {
	const activeSession = p._sessionManager.getActiveSession();
	if (!activeSession) {
		debugLog(
			"[TaskSync] handleAddQueuePrompt — ignored because there is no active session",
		);
		return;
	}

	const trimmed = prompt.trim();
	if (!trimmed || trimmed.length > MAX_QUEUE_PROMPT_LENGTH) {
		debugLog(
			`[TaskSync] handleAddQueuePrompt — rejected: empty or exceeds max length (${trimmed.length}/${MAX_QUEUE_PROMPT_LENGTH})`,
		);
		return;
	}

	debugLog(
		`[TaskSync] handleAddQueuePrompt — prompt: "${trimmed.slice(0, 60)}", attachments: ${attachments.length}, currentToolCallId: ${p._currentToolCallId}`,
	);

	const queuedPrompt: QueuedPrompt = {
		id: isValidQueueId(id) ? id : generateId("q"),
		prompt: trimmed,
		attachments: attachments.length > 0 ? [...attachments] : undefined,
	};

	// Check if we should auto-respond BEFORE adding to queue (race condition fix)
	const currentCallId = p._currentToolCallId;
	const shouldAutoRespond =
		!!activeSession.queueEnabled &&
		currentCallId !== null &&
		p._pendingRequests.has(currentCallId) &&
		activeSession.pendingToolCallId === currentCallId;

	let handledAsToolResponse = false;

	if (shouldAutoRespond) {
		debugLog(
			`[TaskSync] handleAddQueuePrompt — auto-responding to pending tool call: ${currentCallId}`,
		);
		const resolve = p._pendingRequests.get(currentCallId);
		if (!resolve) {
			// Inconsistent state: pending request id without a resolver. Clean up and fall through to queue.
			debugLog(
				`[TaskSync] handleAddQueuePrompt — missing resolver for pending tool call ${currentCallId}, falling back to queue`,
			);
			p._pendingRequests.delete(currentCallId);
			p._toolCallSessionMap.delete(currentCallId);
			p._currentToolCallId = null;
		} else {
			const effectiveResponse = settingsH.applyAutoAppendToResponse(
				p,
				queuedPrompt.prompt,
				activeSession,
			);
			const pendingEntry = p._currentSessionCallsMap.get(currentCallId);

			let completedEntry: ToolCallEntry;
			if (pendingEntry && pendingEntry.status === "pending") {
				pendingEntry.response = effectiveResponse;
				pendingEntry.attachments = queuedPrompt.attachments || [];
				pendingEntry.status = "completed";
				pendingEntry.isFromQueue = true;
				pendingEntry.timestamp = Date.now();
				completedEntry = pendingEntry;
			} else {
				completedEntry = {
					id: currentCallId,
					sessionId: activeSession.id,
					prompt: "Tool call",
					response: effectiveResponse,
					attachments: queuedPrompt.attachments || [],
					timestamp: Date.now(),
					isFromQueue: true,
					status: "completed",
				};
				activeSession.history.unshift(completedEntry);
				p._currentSessionCallsMap.set(completedEntry.id, completedEntry);
			}

			p._view?.webview.postMessage({
				type: "toolCallCompleted",
				entry: completedEntry,
			} satisfies ToWebviewMessage);

			activeSession.pendingToolCallId = null;
			activeSession.waitingOnUser = false;
			activeSession.aiTurnActive = true;
			p._syncActiveSessionState();
			p._saveSessionsToDisk();

			broadcastToolCallCompleted(p, completedEntry);

			p._clearResponseTimeoutTimer(currentCallId);

			resolve({
				value: queuedPrompt.prompt,
				queue: sessionHasQueuedItems(activeSession),
				attachments: queuedPrompt.attachments || [],
			});
			p._pendingRequests.delete(currentCallId);
			p._toolCallSessionMap.delete(currentCallId);

			handledAsToolResponse = true;
		}
	}

	if (!handledAsToolResponse) {
		if (activeSession.queue.length >= MAX_QUEUE_SIZE) {
			debugLog(
				`[TaskSync] handleAddQueuePrompt — rejected: queue full (${activeSession.queue.length}/${MAX_QUEUE_SIZE})`,
			);
			return;
		}
		debugLog(
			`[TaskSync] handleAddQueuePrompt — no pending tool call, adding to session ${activeSession.id} queue (new size: ${activeSession.queue.length + 1})`,
		);
		activeSession.queue.push(queuedPrompt);
		notifyQueueChanged(p);
	}

	// Clear attachments after adding to queue
	activeSession.attachments = [];
	p._attachments = activeSession.attachments;
	p._updateAttachmentsUI();
}

/**
 * Handle removing a prompt from queue.
 */
export function handleRemoveQueuePrompt(p: P, promptId: string): void {
	if (!isValidQueueId(promptId)) return;
	const activeSession = p._sessionManager.getActiveSession();
	if (!activeSession) return;
	const beforeLength = activeSession.queue.length;
	debugLog(
		`[TaskSync] handleRemoveQueuePrompt — promptId: ${promptId}, queueSize before: ${beforeLength}`,
	);
	activeSession.queue = activeSession.queue.filter(
		(pr: QueuedPrompt) => pr.id !== promptId,
	);
	p._promptQueue = activeSession.queue;
	if (activeSession.queue.length !== beforeLength) {
		notifyQueueChanged(p);
	}
}

/**
 * Handle editing a prompt in queue.
 */
export function handleEditQueuePrompt(
	p: P,
	promptId: string,
	newPrompt: string,
): void {
	if (!isValidQueueId(promptId)) return;
	const activeSession = p._sessionManager.getActiveSession();
	if (!activeSession) return;
	const trimmed = newPrompt.trim();
	if (!trimmed || trimmed.length > MAX_QUEUE_PROMPT_LENGTH) return;

	debugLog(
		`[TaskSync] handleEditQueuePrompt — promptId: ${promptId}, newPrompt: "${trimmed.slice(0, 60)}"`,
	);
	const prompt = activeSession.queue.find(
		(pr: QueuedPrompt) => pr.id === promptId,
	);
	if (prompt) {
		prompt.prompt = trimmed;
		notifyQueueChanged(p);
	}
}

/**
 * Handle reordering queue.
 */
export function handleReorderQueue(
	p: P,
	fromIndex: number,
	toIndex: number,
): void {
	const activeSession = p._sessionManager.getActiveSession();
	if (!activeSession) return;
	if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return;
	if (fromIndex < 0 || toIndex < 0) return;
	if (
		fromIndex >= activeSession.queue.length ||
		toIndex >= activeSession.queue.length
	)
		return;
	if (fromIndex === toIndex) return;

	const [removed] = activeSession.queue.splice(fromIndex, 1);
	activeSession.queue.splice(toIndex, 0, removed);
	notifyQueueChanged(p);
}

/**
 * Handle toggling queue enabled state.
 */
export function handleToggleQueue(p: P, enabled: boolean): void {
	const activeSession = p._sessionManager.getActiveSession();
	if (!activeSession) {
		debugLog(
			`[TaskSync] handleToggleQueue — updating default mode with no active session, enabled: ${enabled}`,
		);
		p._queueEnabled = enabled;
		p._saveQueueToDisk();
		p._updateQueueUI();
		p._remoteServer?.broadcast(
			"settingsChanged",
			settingsH.buildSettingsPayload(p),
		);
		return;
	}
	debugLog(
		`[TaskSync] handleToggleQueue — enabled: ${enabled}, queueSize: ${activeSession.queue.length}`,
	);
	activeSession.queueEnabled = enabled;
	p._queueEnabled = enabled;
	p._saveSessionsToDisk();
	p._updateQueueUI();
	p._updateSessionsUI();
	p._remoteServer?.broadcast(
		"settingsChanged",
		settingsH.buildSettingsPayload(p),
	);
}

/**
 * Handle clearing the queue.
 */
export function handleClearQueue(p: P): void {
	const activeSession = p._sessionManager.getActiveSession();
	if (!activeSession) return;
	debugLog(
		`[TaskSync] handleClearQueue — clearing ${activeSession.queue.length} items`,
	);
	activeSession.queue = [];
	p._promptQueue = activeSession.queue;
	notifyQueueChanged(p);
}

/**
 * Handle removing a history item from persisted history (modal only).
 */
export function handleRemoveHistoryItem(p: P, callId: string): void {
	debugLog(`[TaskSync] handleRemoveHistoryItem — callId: ${callId}`);
	p._persistedHistory = p._persistedHistory.filter(
		(tc: ToolCallEntry) => tc.id !== callId,
	);
	p._updatePersistedHistoryUI();
	p._savePersistedHistoryToDisk();
}

/**
 * Handle clearing all persisted history.
 */
export function handleClearPersistedHistory(p: P): void {
	debugLog(
		`[TaskSync] handleClearPersistedHistory — clearing ${p._persistedHistory.length} items`,
	);
	p._persistedHistory = [];
	p._updatePersistedHistoryUI();
	p._savePersistedHistoryToDisk();
}
