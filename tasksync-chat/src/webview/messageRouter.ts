/**
 * Message routing and submit handling extracted from webviewProvider.ts.
 * Contains the main webview message dispatcher, ready handler, and submit logic.
 */

import { isApprovalQuestion, parseChoices } from "./choiceParser";
import * as fileH from "./fileHandlers";
import * as queueH from "./queueHandlers";
import * as settingsH from "./settingsHandlers";
import type {
	AttachmentInfo,
	FromWebviewMessage,
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
	markSessionTerminated,
	notifyQueueChanged,
} from "./webviewUtils";

/**
 * Route incoming webview messages to appropriate handlers.
 */
export function handleWebviewMessage(p: P, message: FromWebviewMessage): void {
	debugLog(`[TaskSync] handleWebviewMessage — type: ${message.type}`);
	switch (message.type) {
		case "submit":
			handleSubmit(p, message.value, message.attachments || []);
			break;
		case "addQueuePrompt":
			queueH.handleAddQueuePrompt(
				p,
				message.prompt,
				message.id,
				message.attachments || [],
			);
			break;
		case "removeQueuePrompt":
			queueH.handleRemoveQueuePrompt(p, message.promptId);
			break;
		case "editQueuePrompt":
			queueH.handleEditQueuePrompt(p, message.promptId, message.newPrompt);
			break;
		case "reorderQueue":
			queueH.handleReorderQueue(p, message.fromIndex, message.toIndex);
			break;
		case "toggleQueue":
			queueH.handleToggleQueue(p, message.enabled);
			break;
		case "clearQueue":
			queueH.handleClearQueue(p);
			break;
		case "addAttachment":
			fileH.handleAddAttachment(p);
			break;
		case "removeAttachment":
			fileH.handleRemoveAttachment(p, message.attachmentId);
			break;
		case "removeHistoryItem":
			queueH.handleRemoveHistoryItem(p, message.callId);
			break;
		case "clearPersistedHistory":
			queueH.handleClearPersistedHistory(p);
			break;
		case "openHistoryModal":
			p._updatePersistedHistoryUI();
			break;
		case "newSession":
			p.startNewSession();
			break;
		case "searchFiles":
			fileH.handleSearchFiles(p, message.query);
			break;
		case "saveImage":
			fileH.handleSaveImage(p, message.data, message.mimeType);
			break;
		case "addFileReference":
			fileH.handleAddFileReference(p, message.file);
			break;
		case "webviewReady":
			handleWebviewReady(p);
			break;
		case "openSettingsModal":
			p._updateSettingsUI();
			break;
		case "updateSoundSetting":
			settingsH.handleUpdateSoundSetting(p, message.enabled);
			break;
		case "updateInteractiveApprovalSetting":
			settingsH.handleUpdateInteractiveApprovalSetting(p, message.enabled);
			break;
		case "updateAutopilotSetting":
			settingsH.handleUpdateAutopilotSetting(p, message.enabled);
			break;
		case "updateAutopilotText":
			settingsH.handleUpdateAutopilotText(p, message.text);
			break;
		case "addAutopilotPrompt":
			settingsH.handleAddAutopilotPrompt(p, message.prompt);
			break;
		case "editAutopilotPrompt":
			settingsH.handleEditAutopilotPrompt(p, message.index, message.prompt);
			break;
		case "removeAutopilotPrompt":
			settingsH.handleRemoveAutopilotPrompt(p, message.index);
			break;
		case "reorderAutopilotPrompts":
			settingsH.handleReorderAutopilotPrompts(
				p,
				message.fromIndex,
				message.toIndex,
			);
			break;
		case "addReusablePrompt":
			settingsH.handleAddReusablePrompt(p, message.name, message.prompt);
			break;
		case "editReusablePrompt":
			settingsH.handleEditReusablePrompt(
				p,
				message.id,
				message.name,
				message.prompt,
			);
			break;
		case "removeReusablePrompt":
			settingsH.handleRemoveReusablePrompt(p, message.id);
			break;
		case "searchSlashCommands":
			settingsH.handleSearchSlashCommands(p, message.query);
			break;
		case "openExternal":
			fileH.handleOpenExternalLink(message.url);
			break;
		case "openFileLink":
			void fileH.handleOpenFileLink(message.target);
			break;
		case "updateResponseTimeout":
			settingsH.handleUpdateResponseTimeout(p, message.value);
			break;
		case "updateSessionWarningHours":
			settingsH.handleUpdateSessionWarningHours(p, message.value);
			break;
		case "updateMaxConsecutiveAutoResponses":
			settingsH.handleUpdateMaxConsecutiveAutoResponses(p, message.value);
			break;
		case "updateHumanDelaySetting":
			settingsH.handleUpdateHumanDelaySetting(p, message.enabled);
			break;
		case "updateHumanDelayMin":
			settingsH.handleUpdateHumanDelayMin(p, message.value);
			break;
		case "updateHumanDelayMax":
			settingsH.handleUpdateHumanDelayMax(p, message.value);
			break;
		case "updateSendWithCtrlEnterSetting":
			settingsH.handleUpdateSendWithCtrlEnterSetting(p, message.enabled);
			break;
		case "searchContext":
			fileH.handleSearchContext(p, message.query);
			break;
		case "selectContextReference":
			fileH.handleSelectContextReference(
				p,
				message.contextType,
				message.options,
			);
			break;
		case "copyToClipboard":
			void fileH.handleCopyToClipboard(message.text);
			break;
		default: {
			const _exhaustiveCheck: never = message;
			console.error(
				`Unhandled webview message type: ${(_exhaustiveCheck as FromWebviewMessage).type}`,
			);
		}
	}
}

/**
 * Handle webview ready signal — send initial state and any pending messages.
 */
export function handleWebviewReady(p: P): void {
	debugLog(
		`[TaskSync] handleWebviewReady — pendingToolCallMessage: ${!!p._pendingToolCallMessage}, currentToolCallId: ${p._currentToolCallId}, pendingRequests: ${p._pendingRequests.size}`,
	);
	p._webviewReady = true;

	// Send settings
	p._updateSettingsUI();
	// Send initial queue state and current session history
	p._updateQueueUI();
	p._updateCurrentSessionUI();

	// If there's a pending tool call message that was never sent, send it now
	if (p._pendingToolCallMessage) {
		debugLog(
			`[TaskSync] handleWebviewReady — sending deferred toolCallPending message, id: ${p._pendingToolCallMessage.id}`,
		);
		const prompt = p._pendingToolCallMessage.prompt;
		const choices = parseChoices(prompt);
		const isApproval = choices.length === 0 && isApprovalQuestion(prompt);
		p._view?.webview.postMessage({
			type: "toolCallPending",
			id: p._pendingToolCallMessage.id,
			prompt: prompt,
			isApproval,
			choices: choices.length > 0 ? choices : undefined,
			summary: p._pendingToolCallMessage.summary,
		} satisfies ToWebviewMessage);
		p._pendingToolCallMessage = null;
	}
	// If there's an active pending request (webview was hidden/recreated while waiting),
	// re-send the pending tool call message so the user sees the question again
	else if (
		p._currentToolCallId &&
		p._pendingRequests.has(p._currentToolCallId)
	) {
		debugLog(
			`[TaskSync] handleWebviewReady — re-sending pending tool call, id: ${p._currentToolCallId}`,
		);
		// Find the pending entry to get the prompt
		const pendingEntry = p._currentSessionCallsMap.get(p._currentToolCallId);
		if (pendingEntry && pendingEntry.status === "pending") {
			const prompt = pendingEntry.prompt;
			const choices = parseChoices(prompt);
			const isApproval = choices.length === 0 && isApprovalQuestion(prompt);
			p._view?.webview.postMessage({
				type: "toolCallPending",
				id: p._currentToolCallId,
				prompt: prompt,
				isApproval,
				choices: choices.length > 0 ? choices : undefined,
				summary: pendingEntry.summary,
			} satisfies ToWebviewMessage);
		}
	}
}

/**
 * Handle submit from webview.
 */
export function handleSubmit(
	p: P,
	value: string,
	attachments: AttachmentInfo[],
): void {
	// Cancel response timeout timer (user responded)
	if (p._responseTimeoutTimer) {
		debugLog("[TaskSync] handleSubmit — cancelling response timeout timer");
		clearTimeout(p._responseTimeoutTimer);
		p._responseTimeoutTimer = null;
	}
	// Reset consecutive auto-responses counter on manual response
	p._consecutiveAutoResponses = 0;

	if (p._pendingRequests.size > 0 && p._currentToolCallId) {
		const resolve = p._pendingRequests.get(p._currentToolCallId);
		if (resolve) {
			debugLog(
				"[TaskSync] handleSubmit — resolving toolCallId:",
				p._currentToolCallId,
				"response:",
				value.slice(0, 80),
			);
			// O(1) lookup using Map instead of O(n) findIndex
			const pendingEntry = p._currentSessionCallsMap.get(p._currentToolCallId);

			let completedEntry: ToolCallEntry;
			if (pendingEntry && pendingEntry.status === "pending") {
				// Update existing pending entry
				pendingEntry.response = value;
				pendingEntry.attachments = attachments;
				pendingEntry.status = "completed";
				pendingEntry.timestamp = Date.now();
				completedEntry = pendingEntry;
			} else {
				// Create new completed entry (shouldn't happen normally)
				completedEntry = {
					id: p._currentToolCallId,
					prompt: "Tool call",
					response: value,
					attachments: attachments,
					timestamp: Date.now(),
					isFromQueue: false,
					status: "completed",
				};
				p._currentSessionCalls.unshift(completedEntry);
				p._currentSessionCallsMap.set(completedEntry.id, completedEntry);
			}

			// Detect session termination
			const isTermination = value === p._SESSION_TERMINATION_TEXT;

			// Send toolCallCompleted to trigger "Working...." state in webview
			p._view?.webview.postMessage({
				type: "toolCallCompleted",
				entry: completedEntry,
				sessionTerminated: isTermination,
			} satisfies ToWebviewMessage);

			// Broadcast to remote clients so they see the answer
			broadcastToolCallCompleted(p, completedEntry, isTermination);

			p._updateCurrentSessionUI();
			resolve({
				value,
				queue: hasQueuedItems(p),
				attachments,
			});
			p._pendingRequests.delete(p._currentToolCallId);
			p._currentToolCallId = null;
			p._aiTurnActive = true; // AI is now processing the response
			debugLog(
				`[TaskSync] handleSubmit — resolved, aiTurnActive: true, isTermination: ${isTermination}`,
			);

			// Mark session as terminated if termination text was submitted
			if (isTermination) {
				debugLog("[TaskSync] handleSubmit — marking session terminated");
				markSessionTerminated(p);
			}
		} else {
			debugLog(
				`[TaskSync] handleSubmit — no resolve found for toolCallId: ${p._currentToolCallId}, adding to queue`,
			);
			// No pending tool call - add message to queue for later use
			if (value && value.trim()) {
				const queuedPrompt: QueuedPrompt = {
					id: generateId("q"),
					prompt: value.trim(),
					attachments: attachments.length > 0 ? [...attachments] : undefined,
				};
				p._promptQueue.push(queuedPrompt);
				// Auto-switch to queue mode so user sees their message went to queue
				p._queueEnabled = true;
				notifyQueueChanged(p);
			}
		}
	} else {
		debugLog(
			"[TaskSync] handleSubmit — no pending tool call, queueing message",
		);
		// No active tool call - queue message if it has content so it is not dropped
		if (value && value.trim()) {
			const queuedPrompt: QueuedPrompt = {
				id: generateId("q"),
				prompt: value.trim(),
				attachments: attachments.length > 0 ? [...attachments] : undefined,
			};
			p._promptQueue.push(queuedPrompt);
			// Auto-switch to queue mode so user sees their message went to queue
			p._queueEnabled = true;
			notifyQueueChanged(p);
		}
	}

	// NOTE: Temp images are NOT cleaned up here anymore.
	// They are stored in the ToolCallEntry.attachments and will be cleaned up when:
	// 1. clearCurrentSession() is called
	// 2. dispose() is called (extension deactivation)

	// Clear attachments after submit and sync with webview
	p._attachments = [];
	p._updateAttachmentsUI();
}
