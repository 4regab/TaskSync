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
	markSessionTerminated,
	notifyQueueChanged,
	sessionHasQueuedItems,
} from "./webviewUtils";

/**
 * Route incoming webview messages to appropriate handlers.
 */
export function handleWebviewMessage(p: P, message: FromWebviewMessage): void {
	debugLog(`[TaskSync] handleWebviewMessage — type: ${message.type}`);
	switch (message.type) {
		case "submit":
			handleSubmit(
				p,
				message.sessionId,
				message.toolCallId,
				message.value,
				message.attachments || [],
			);
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
			void p
				.startNewSessionAndResetCopilotChat({
					initialPrompt: message.initialPrompt,
					useQueuedPrompt: message.useQueuedPrompt,
					stopCurrentSession: message.stopCurrentSession,
				})
				.catch((err: unknown) => {
					console.error("[TaskSync] Failed to start fresh Copilot chat:", err);
				});
			break;
		case "resetSession":
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
		case "updateAutoAppendSetting":
			settingsH.handleUpdateAutoAppendSetting(p, message.enabled);
			break;
		case "updateAutoAppendText":
			settingsH.handleUpdateAutoAppendText(p, message.text);
			break;
		case "updateAlwaysAppendReminderSetting":
			settingsH.handleUpdateAlwaysAppendReminderSetting(p, message.enabled);
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
		case "saveAutopilotPrompts":
			settingsH.handleSaveAutopilotPrompts(p, message.prompts);
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
		case "updateRemoteMaxDevices":
			settingsH.handleUpdateRemoteMaxDevices(p, message.value);
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
		case "switchSession":
			if (p._setActiveSession(message.sessionId)) {
				const activeSession = p._sessionManager.getActiveSession();
				if (activeSession?.pendingToolCallId) {
					const pendingEntry = p._currentSessionCallsMap.get(
						activeSession.pendingToolCallId,
					);
					if (pendingEntry && pendingEntry.status === "pending") {
						const choices = parseChoices(pendingEntry.prompt);
						const isApproval =
							choices.length === 0 && isApprovalQuestion(pendingEntry.prompt);
						p._view?.webview.postMessage({
							type: "toolCallPending",
							id: pendingEntry.id,
							sessionId: activeSession.id,
							prompt: pendingEntry.prompt,
							isApproval,
							choices: choices.length > 0 ? choices : undefined,
						} satisfies ToWebviewMessage);
					}
				} else {
					p._view?.webview.postMessage({
						type: "clearPendingState",
					} satisfies ToWebviewMessage);
				}
				p._saveSessionsToDisk();
				p._updateSessionsUI();
				settingsH.sendSessionSettingsToWebview(p);
			}

			break;
		case "archiveSession": {
			const sessionToArchive = p._getSession(message.sessionId);
			if (sessionToArchive?.pendingToolCallId) {
				p.cancelPendingToolCall(
					"[Session archived by user]",
					message.sessionId,
				);
			}
			if (sessionToArchive) {
				for (const entry of sessionToArchive.history) {
					p._currentSessionCallsMap.delete(entry.id);
					p._toolCallSessionMap.delete(entry.id);
				}
			}
			if (p._sessionManager.archiveSession(message.sessionId)) {
				p._syncActiveSessionState();
				p._saveSessionsToDisk();
				p._updateSessionsUI();
			}
			break;
		}
		case "deleteSession":
			const sessionToDelete = p._getSession(message.sessionId);
			if (sessionToDelete?.pendingToolCallId) {
				p.cancelPendingToolCall("[Session deleted by user]", message.sessionId);
			}
			if (sessionToDelete) {
				for (const entry of sessionToDelete.history) {
					p._currentSessionCallsMap.delete(entry.id);
					p._toolCallSessionMap.delete(entry.id);
				}
			}
			if (p._sessionManager.deleteSession(message.sessionId)) {
				p._syncActiveSessionState();
				p._saveSessionsToDisk();
				p._updateSessionsUI();
			}
			break;
		case "updateSessionTitle":
			if (p._sessionManager.renameSession(message.sessionId, message.title)) {
				p._saveSessionsToDisk();
				p._updateSessionsUI();
			}
			break;
		case "updateSessionSettings":
			settingsH.handleUpdateSessionSettings(p, message);
			break;
		case "resetSessionSettings":
			settingsH.handleResetSessionSettings(p);
			break;
		case "requestSessionSettings":
			settingsH.sendSessionSettingsToWebview(p);
			break;
		case "saveAutoAppendAsWorkspaceDefault":
			settingsH.handleSaveAutoAppendAsWorkspaceDefault(p);
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
	// Send session-level overrides (gear indicator)
	settingsH.sendSessionSettingsToWebview(p);
	// Send initial queue state and current session history
	p._updateQueueUI();
	p._updateCurrentSessionUI();
	p._updatePersistedHistoryUI();
	// Send multi-session state
	p._updateSessionsUI();

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
			sessionId: p._pendingToolCallMessage.sessionId,
			prompt: prompt,
			isApproval,
			choices: choices.length > 0 ? choices : undefined,
		} satisfies ToWebviewMessage);
		p.playNotificationSound?.();
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
				sessionId:
					pendingEntry.sessionId ??
					p._sessionManager.getActiveSessionId() ??
					"",
				prompt: prompt,
				isApproval,
				choices: choices.length > 0 ? choices : undefined,
			} satisfies ToWebviewMessage);
			p.playNotificationSound?.();
		}
	}
}

/**
 * Handle submit from webview.
 */
export function handleSubmit(
	p: P,
	sessionId: string | null,
	toolCallId: string | null | undefined,
	value: string,
	attachments: AttachmentInfo[],
): void {
	const activeSession = p._sessionManager.getActiveSession();
	if (!activeSession || !sessionId || activeSession.id !== sessionId) {
		debugLog(
			`[TaskSync] handleSubmit — rejected due to active session mismatch. active=${activeSession?.id ?? "none"} incoming=${sessionId ?? "none"}`,
		);
		return;
	}
	activeSession.consecutiveAutoResponses = 0;
	const currentPendingId = activeSession.pendingToolCallId;
	const resolvedToolCallId =
		typeof toolCallId === "string" && toolCallId.length > 0
			? toolCallId
			: currentPendingId;

	if (
		currentPendingId &&
		resolvedToolCallId === currentPendingId &&
		p._pendingRequests.size > 0
	) {
		p._clearResponseTimeoutTimer(currentPendingId);
		const resolve = p._pendingRequests.get(currentPendingId);
		if (resolve) {
			const effectiveResponse = settingsH.applyAutoAppendToResponse(
				p,
				value,
				activeSession,
			);
			debugLog(
				"[TaskSync] handleSubmit — resolving toolCallId:",
				currentPendingId,
				"response:",
				value.slice(0, 80),
			);
			// O(1) lookup using Map instead of O(n) findIndex
			const pendingEntry = p._currentSessionCallsMap.get(currentPendingId);

			let completedEntry: ToolCallEntry;
			if (pendingEntry && pendingEntry.status === "pending") {
				// Update existing pending entry
				pendingEntry.response = effectiveResponse;
				pendingEntry.attachments = attachments;
				pendingEntry.status = "completed";
				pendingEntry.timestamp = Date.now();
				completedEntry = pendingEntry;
			} else {
				// Create new completed entry (shouldn't happen normally)
				completedEntry = {
					id: currentPendingId,
					sessionId: activeSession.id,
					prompt: "Tool call",
					response: effectiveResponse,
					attachments: attachments,
					timestamp: Date.now(),
					isFromQueue: false,
					status: "completed",
				};
				activeSession.history.unshift(completedEntry);
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
				queue: sessionHasQueuedItems(activeSession),
				attachments,
			});
			p._pendingRequests.delete(currentPendingId);
			p._toolCallSessionMap.delete(currentPendingId);
			activeSession.pendingToolCallId = null;
			activeSession.waitingOnUser = false;
			activeSession.aiTurnActive = true; // AI is now processing the response
			debugLog(
				`[TaskSync] handleSubmit — resolved, aiTurnActive: true, isTermination: ${isTermination}`,
			);

			// Mark session as terminated if termination text was submitted
			if (isTermination) {
				debugLog("[TaskSync] handleSubmit — marking session terminated");
				markSessionTerminated(p, activeSession);
			}
			p._syncActiveSessionState();
			p._saveSessionsToDisk();
		} else {
			debugLog(
				`[TaskSync] handleSubmit — no resolve found for toolCallId: ${currentPendingId}, stale state — queueing message instead of dropping it`,
			);
			// Resolver is gone (e.g. after reload) — queue the message so the user's input isn't lost
			if (value && value.trim()) {
				const queuedPrompt: QueuedPrompt = {
					id: generateId("q"),
					prompt: value.trim(),
					attachments: attachments.length > 0 ? [...attachments] : undefined,
				};
				activeSession.queue.push(queuedPrompt);
				activeSession.queueEnabled = true;
				p._queueEnabled = true;
				notifyQueueChanged(p);
			}
			// Clean up the stale pending state
			activeSession.pendingToolCallId = null;
			activeSession.waitingOnUser = false;
			p._syncActiveSessionState();
			p._saveSessionsToDisk();
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
			activeSession.queue.push(queuedPrompt);
			// Auto-switch to queue mode so user sees their message went to queue
			activeSession.queueEnabled = true;
			p._queueEnabled = true;
			notifyQueueChanged(p);
		}
	}

	// NOTE: Temp images are NOT cleaned up here anymore.
	// They are stored in the ToolCallEntry.attachments and will be cleaned up when:
	// 1. clearCurrentSession() is called
	// 2. dispose() is called (extension deactivation)

	// Clear attachments after submit and sync with webview
	activeSession.attachments = [];
	p._attachments = activeSession.attachments;
	p._updateAttachmentsUI();
}
