import {
	isValidQueueId,
	MAX_QUEUE_PROMPT_LENGTH,
} from "../constants/remoteConstants";
import { buildSettingsPayload } from "./settingsHandlers";
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
	hasQueuedItems,
	notifyQueueChanged,
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
		id: id || generateId("q"),
		prompt: trimmed,
		attachments: attachments.length > 0 ? [...attachments] : undefined,
	};

	// Check if we should auto-respond BEFORE adding to queue (race condition fix)
	const currentCallId = p._currentToolCallId;
	const shouldAutoRespond =
		p._queueEnabled && currentCallId && p._pendingRequests.has(currentCallId);

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
			p._currentToolCallId = null;
		} else {
			const pendingEntry = p._currentSessionCallsMap.get(currentCallId);

			let completedEntry: ToolCallEntry;
			if (pendingEntry && pendingEntry.status === "pending") {
				pendingEntry.response = queuedPrompt.prompt;
				pendingEntry.attachments = queuedPrompt.attachments || [];
				pendingEntry.status = "completed";
				pendingEntry.isFromQueue = true;
				pendingEntry.timestamp = Date.now();
				completedEntry = pendingEntry;
			} else {
				completedEntry = {
					id: currentCallId,
					prompt: "Tool call",
					response: queuedPrompt.prompt,
					attachments: queuedPrompt.attachments || [],
					timestamp: Date.now(),
					isFromQueue: true,
					status: "completed",
				};
				p._currentSessionCalls.unshift(completedEntry);
				p._currentSessionCallsMap.set(completedEntry.id, completedEntry);
			}

			p._view?.webview.postMessage({
				type: "toolCallCompleted",
				entry: completedEntry,
			} satisfies ToWebviewMessage);

			p._updateCurrentSessionUI();
			p._saveQueueToDisk();
			p._updateQueueUI();

			broadcastToolCallCompleted(p, completedEntry);

			// Clear response timeout timer (matches resolveRemoteResponse behavior)
			if (p._responseTimeoutTimer) {
				clearTimeout(p._responseTimeoutTimer);
				p._responseTimeoutTimer = null;
			}

			resolve({
				value: queuedPrompt.prompt,
				queue: hasQueuedItems(p),
				attachments: queuedPrompt.attachments || [],
			});
			p._aiTurnActive = true;
			p._pendingRequests.delete(currentCallId);
			p._currentToolCallId = null;
			handledAsToolResponse = true;
		}
	}

	if (!handledAsToolResponse) {
		debugLog(
			`[TaskSync] handleAddQueuePrompt — no pending tool call, adding to queue (new size: ${p._promptQueue.length + 1})`,
		);
		p._promptQueue.push(queuedPrompt);
		notifyQueueChanged(p);
	}

	// Clear attachments after adding to queue
	p._attachments = [];
	p._updateAttachmentsUI();
}

/**
 * Handle removing a prompt from queue.
 */
export function handleRemoveQueuePrompt(p: P, promptId: string): void {
	if (!isValidQueueId(promptId)) return;
	const beforeLength = p._promptQueue.length;
	debugLog(
		`[TaskSync] handleRemoveQueuePrompt — promptId: ${promptId}, queueSize before: ${beforeLength}`,
	);
	p._promptQueue = p._promptQueue.filter(
		(pr: QueuedPrompt) => pr.id !== promptId,
	);
	if (p._promptQueue.length !== beforeLength) {
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
	const trimmed = newPrompt.trim();
	if (!trimmed || trimmed.length > MAX_QUEUE_PROMPT_LENGTH) return;

	debugLog(
		`[TaskSync] handleEditQueuePrompt — promptId: ${promptId}, newPrompt: "${trimmed.slice(0, 60)}"`,
	);
	const prompt = p._promptQueue.find((pr: QueuedPrompt) => pr.id === promptId);
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
	if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return;
	if (fromIndex < 0 || toIndex < 0) return;
	if (fromIndex >= p._promptQueue.length || toIndex >= p._promptQueue.length)
		return;

	const [removed] = p._promptQueue.splice(fromIndex, 1);
	p._promptQueue.splice(toIndex, 0, removed);
	notifyQueueChanged(p);
}

/**
 * Handle toggling queue enabled state.
 */
export function handleToggleQueue(p: P, enabled: boolean): void {
	debugLog(
		`[TaskSync] handleToggleQueue — enabled: ${enabled}, queueSize: ${p._promptQueue.length}`,
	);
	p._queueEnabled = enabled;
	p._saveQueueToDisk();
	p._updateQueueUI();
	p._remoteServer?.broadcast("settingsChanged", buildSettingsPayload(p));
}

/**
 * Handle clearing the queue.
 */
export function handleClearQueue(p: P): void {
	debugLog(
		`[TaskSync] handleClearQueue — clearing ${p._promptQueue.length} items`,
	);
	p._promptQueue = [];
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
