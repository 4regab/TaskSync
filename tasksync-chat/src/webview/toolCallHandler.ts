/**
 * Tool call handling logic extracted from webviewProvider.ts.
 * Contains waitForUserResponse, timeout handling, and request cancellation.
 */
import * as vscode from "vscode";
import {
	CONFIG_SECTION,
	DEFAULT_MAX_CONSECUTIVE_AUTO_RESPONSES,
} from "../constants/remoteConstants";

import { isApprovalQuestion, parseChoices } from "./choiceParser";
import * as settingsH from "./settingsHandlers";
import type {
	ChatSession,
	P,
	ToolCallEntry,
	ToWebviewMessage,
	UserResponseResult,
} from "./webviewTypes";
import { VIEW_TYPE } from "./webviewTypes";
import {
	broadcastToolCallCompleted,
	debugLog,
	generateId,
	markSessionTerminated,
	notifyQueueChanged,
	sessionHasQueuedItems,
} from "./webviewUtils";

/**
 * Persist session state and refresh only the active thread's mirrors when needed.
 */
function persistSessionState(p: P, session: ChatSession): void {
	if (p._sessionManager.getActiveSessionId() === session.id) {
		p._syncActiveSessionState();
	} else {
		p._updateSessionsUI();
	}
	p._saveSessionsToDisk();
}

function buildRejectedResult(
	session: ChatSession | undefined,
	message: string,
): UserResponseResult {
	return {
		value: message,
		queue: session ? sessionHasQueuedItems(session) : false,
		attachments: [],
		cancelled: true,
	};
}

function isSessionActive(p: P, sessionId: string): boolean {
	return p._sessionManager.getActiveSessionId() === sessionId;
}

function replacePendingToolCallForSession(p: P, session: ChatSession): void {
	const previousToolCallId = session.pendingToolCallId;
	if (!previousToolCallId) return;

	debugLog(
		`[TaskSync] waitForUserResponse — replacing existing pending ask_user for session ${session.id}, previousToolCallId: ${previousToolCallId}`,
	);

	p._clearResponseTimeoutTimer(previousToolCallId);

	const previousResolve = p._pendingRequests.get(previousToolCallId);
	p._pendingRequests.delete(previousToolCallId);
	p._toolCallSessionMap.delete(previousToolCallId);
	p._currentSessionCallsMap.delete(previousToolCallId);
	session.history = session.history.filter(
		(entry) => entry.id !== previousToolCallId,
	);

	session.pendingToolCallId = null;
	session.waitingOnUser = false;

	if (previousResolve) {
		previousResolve({
			value:
				"TaskSync replaced a previous unanswered ask_user in this same session because a newer ask_user arrived.",
			queue: sessionHasQueuedItems(session),
			attachments: [],
			cancelled: true,
		} satisfies UserResponseResult);
	}
}

function postPendingToActiveWebview(
	p: P,
	session: ChatSession,
	entry: ToolCallEntry,
): void {
	const choices = parseChoices(entry.prompt);
	const isApproval = choices.length === 0 && isApprovalQuestion(entry.prompt);

	if (p._webviewReady && p._view) {
		p._view.webview.postMessage({
			type: "toolCallPending",
			id: entry.id,
			sessionId: session.id,
			prompt: entry.prompt,
			isApproval,
			choices: choices.length > 0 ? choices : undefined,
		} satisfies ToWebviewMessage);
		return;
	}

	p._pendingToolCallMessage = {
		id: entry.id,
		sessionId: session.id,
		prompt: entry.prompt,
	};
}

/**
 * Core tool call handler — waits for user response via webview.
 */
export async function waitForUserResponse(
	p: P,
	question: string,
	sessionId?: string,
): Promise<UserResponseResult> {
	const normalizedSessionId = sessionId?.trim();
	debugLog(
		"[TaskSync] waitForUserResponse — question:",
		question.slice(0, 80),
		"sessionId:",
		normalizedSessionId || "<missing>",
	);

	if (!normalizedSessionId) {
		return buildRejectedResult(
			undefined,
			"TaskSync rejected ask_user because session_id is required. Start a TaskSync conversation and pass that exact session_id on every ask_user call.",
		);
	}

	const session = p._bindSession(normalizedSessionId);
	const activeSession = isSessionActive(p, session.id);

	if (session.pendingToolCallId) {
		replacePendingToolCallForSession(p, session);
	}

	if (session.sessionTerminated) {
		return buildRejectedResult(
			session,
			`TaskSync rejected ask_user for session_id ${session.id} because this conversation is already terminated. Start a new Copilot chat that uses a new session_id instead of reusing this one.`,
		);
	}

	session.aiTurnActive = false;

	if (session.sessionStartTime === null) {
		session.sessionStartTime = Date.now();
		session.sessionFrozenElapsed = null;
	}

	if (!p._view) {
		await vscode.commands.executeCommand(`${VIEW_TYPE}.focus`);

		let waited = 0;
		while (!p._view && waited < p._VIEW_OPEN_TIMEOUT_MS) {
			await new Promise((resolve) =>
				setTimeout(resolve, p._VIEW_OPEN_POLL_INTERVAL_MS),
			);
			waited += p._VIEW_OPEN_POLL_INTERVAL_MS;
		}

		if (!p._view) {
			console.error(
				`[TaskSync] Failed to open sidebar view after waiting ${p._VIEW_OPEN_TIMEOUT_MS}ms`,
			);
			throw new Error(
				`Failed to open TaskSync sidebar after ${p._VIEW_OPEN_TIMEOUT_MS}ms. The webview may not be properly initialized.`,
			);
		}
	}

	if (session.autopilotEnabled && !sessionHasQueuedItems(session)) {
		debugLog(
			`[TaskSync] waitForUserResponse — autopilot enabled for session ${session.id}, no queue items, auto-responding`,
		);
		session.consecutiveAutoResponses++;

		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		const maxConsecutive = config.get<number>(
			"maxConsecutiveAutoResponses",
			DEFAULT_MAX_CONSECUTIVE_AUTO_RESPONSES,
		);

		if (session.consecutiveAutoResponses > maxConsecutive) {
			debugLog(
				`[TaskSync] waitForUserResponse — autopilot limit reached for session ${session.id} (${session.consecutiveAutoResponses}/${maxConsecutive}), disabling`,
			);
			session.autopilotEnabled = false;
			persistSessionState(p, session);
			vscode.window.showWarningMessage(
				`TaskSync: Auto-response limit (${maxConsecutive}) reached. Waiting for response or timeout.`,
			);
		} else {
			await p._applyHumanLikeDelay("Autopilot");

			if (session.autopilotEnabled) {
				let effectiveText: string;
				// Use session-level prompts/text only — never fall back to provider mirrors
				// which reflect the active session and leak across sessions.
				const prompts = Array.isArray(session.autopilotPrompts)
					? session.autopilotPrompts
					: [];
				if (prompts.length > 0) {
					effectiveText = prompts[session.autopilotIndex] ?? prompts[0];
					session.autopilotIndex =
						(session.autopilotIndex + 1) % prompts.length;
				} else {
					const text = session.autopilotText ?? "";
					effectiveText = settingsH.normalizeAutopilotText(p, text);
				}
				debugLog(
					`[TaskSync] waitForUserResponse — autopilot auto-responding for session ${session.id} with: "${effectiveText.slice(0, 60)}" (${session.consecutiveAutoResponses}/${maxConsecutive})`,
				);
				const effectiveResponse = settingsH.applyAutoAppendToResponse(
					p,
					effectiveText,
					session,
				);
				vscode.window.showInformationMessage(
					`TaskSync: Autopilot auto-responded. (${session.consecutiveAutoResponses}/${maxConsecutive})`,
				);

				const entry: ToolCallEntry = {
					id: generateId("tc"),
					sessionId: session.id,
					prompt: question,
					response: effectiveResponse,
					timestamp: Date.now(),
					isFromQueue: false,
					status: "completed",
				};
				session.history.unshift(entry);
				p._currentSessionCallsMap.set(entry.id, entry);
				session.aiTurnActive = true;
				persistSessionState(p, session);

				if (activeSession) {
					broadcastToolCallCompleted(p, entry);
				}

				return {
					value: effectiveText,
					queue: sessionHasQueuedItems(session),
					attachments: [],
				};
			}
		}
	}

	const toolCallId = generateId("tc");
	p._toolCallSessionMap.set(toolCallId, session.id);
	session.pendingToolCallId = toolCallId;
	session.waitingOnUser = true;

	if (sessionHasQueuedItems(session)) {
		debugLog(
			`[TaskSync] waitForUserResponse — session ${session.id} queue has ${session.queue.length} items, attempting auto-respond from queue`,
		);
		const queuedPrompt = session.queue.shift();
		if (queuedPrompt) {
			if (activeSession) {
				notifyQueueChanged(p);
			} else {
				p._updateSessionsUI();
				p._saveSessionsToDisk();
			}

			await p._applyHumanLikeDelay("Queue");

			if (!session.queueEnabled || session.pendingToolCallId !== toolCallId) {
				debugLog(
					`[TaskSync] waitForUserResponse — session ${session.id} queue disabled or toolCallId changed during delay, re-queuing`,
				);
				session.queue.unshift(queuedPrompt);
				p._toolCallSessionMap.delete(toolCallId);
				if (session.pendingToolCallId === toolCallId) {
					session.pendingToolCallId = null;
					session.waitingOnUser = false;
				}
				if (activeSession) {
					notifyQueueChanged(p);
				} else {
					p._updateSessionsUI();
					p._saveSessionsToDisk();
				}
			} else {
				debugLog(
					`[TaskSync] waitForUserResponse — session ${session.id} queue auto-responding with: "${queuedPrompt.prompt.slice(0, 60)}"`,
				);
				const effectiveResponse = settingsH.applyAutoAppendToResponse(
					p,
					queuedPrompt.prompt,
					session,
				);
				const entry: ToolCallEntry = {
					id: toolCallId,
					sessionId: session.id,
					prompt: question,
					response: effectiveResponse,
					timestamp: Date.now(),
					isFromQueue: true,
					status: "completed",
				};
				session.history.unshift(entry);
				p._currentSessionCallsMap.set(entry.id, entry);
				session.pendingToolCallId = null;
				session.waitingOnUser = false;
				session.aiTurnActive = true;
				p._toolCallSessionMap.delete(toolCallId);
				persistSessionState(p, session);

				if (activeSession) {
					broadcastToolCallCompleted(p, entry);
				}

				return {
					value: queuedPrompt.prompt,
					queue: sessionHasQueuedItems(session),
					attachments: queuedPrompt.attachments || [],
				};
			}
		}
	}

	if (activeSession) {
		p._view?.show(true);
	}

	debugLog(
		`[TaskSync] waitForUserResponse — creating pending entry, session: ${session.id}, toolCallId: ${toolCallId}, webviewReady: ${p._webviewReady}, isActiveSession: ${activeSession}`,
	);
	const pendingEntry: ToolCallEntry = {
		id: toolCallId,
		sessionId: session.id,
		prompt: question,
		response: "",
		timestamp: Date.now(),
		isFromQueue: false,
		status: "pending",
	};
	session.history.unshift(pendingEntry);
	p._currentSessionCallsMap.set(toolCallId, pendingEntry);

	// Wait for webview to be ready
	if (!p._webviewReady) {
		const maxWaitMs = 3000;
		const pollIntervalMs = 50;
		let waited = 0;
		while (!p._webviewReady && waited < maxWaitMs) {
			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
			waited += pollIntervalMs;
		}
	}

	if (activeSession) {
		postPendingToActiveWebview(p, session, pendingEntry);
	}

	if (p._webviewReady && p._view) {
		p.playNotificationSound();
	}

	if (activeSession) {
		const choices = parseChoices(question);
		const isApproval = choices.length === 0 && isApprovalQuestion(question);
		p._remoteServer?.broadcast("toolCallPending", {
			id: toolCallId,
			sessionId: session.id,
			prompt: question,
			isApproval,
			timestamp: Date.now(),
			sessionStartTime: session.sessionStartTime,
			sessionFrozenElapsed: session.sessionFrozenElapsed,
			choices:
				choices.length > 0
					? choices.map(
							(c: { label: string; value: string; shortLabel?: string }) => ({
								label: c.label,
								value: c.value,
								shortLabel: c.shortLabel,
							}),
						)
					: undefined,
		});
	}

	persistSessionState(p, session);

	debugLog(
		`[TaskSync] waitForUserResponse — waiting for user input, session: ${session.id}, toolCallId: ${toolCallId}`,
	);
	return new Promise<UserResponseResult>((resolve) => {
		p._pendingRequests.set(toolCallId, resolve);
		startResponseTimeoutTimer(p, toolCallId, session.id);
	});
}

/**
 * Start response timeout timer for a pending tool call.
 */
export function startResponseTimeoutTimer(
	p: P,
	toolCallId: string,
	sessionId: string,
): void {
	p._clearResponseTimeoutTimer(toolCallId);
	const timeoutMinutes = settingsH.readResponseTimeoutMinutes();
	if (timeoutMinutes <= 0) {
		debugLog(
			`[TaskSync] startResponseTimeoutTimer — timeout disabled (${timeoutMinutes} min), no timer set`,
		);
		return;
	}

	const timeoutMs = timeoutMinutes * 60 * 1000;
	debugLog(
		`[TaskSync] startResponseTimeoutTimer — setting ${timeoutMinutes} min timer for session ${sessionId}, toolCallId: ${toolCallId}`,
	);

	const timer = setTimeout(() => {
		void handleResponseTimeout(p, toolCallId, sessionId);
	}, timeoutMs);
	p._responseTimeoutTimers.set(toolCallId, timer);
}

/**
 * Handle response timeout — auto-respond after user idle.
 */
export async function handleResponseTimeout(
	p: P,
	toolCallId: string,
	sessionId: string,
): Promise<void> {
	debugLog(
		`[TaskSync] handleResponseTimeout — sessionId: ${sessionId}, toolCallId: ${toolCallId}`,
	);
	p._responseTimeoutTimers.delete(toolCallId);

	const session = p._getSession(sessionId);
	if (!session) {
		return;
	}

	if (
		session.pendingToolCallId !== toolCallId ||
		!p._pendingRequests.has(toolCallId)
	) {
		debugLog("[TaskSync] handleResponseTimeout — stale timeout, ignoring");
		return;
	}

	await p._applyHumanLikeDelay("Timeout");

	if (
		session.pendingToolCallId !== toolCallId ||
		!p._pendingRequests.has(toolCallId)
	) {
		return;
	}

	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const timeoutMinutes = settingsH.readResponseTimeoutMinutes(config);
	const maxConsecutive = config.get<number>(
		"maxConsecutiveAutoResponses",
		DEFAULT_MAX_CONSECUTIVE_AUTO_RESPONSES,
	);

	session.consecutiveAutoResponses++;
	let responseText: string;
	let isTermination = false;

	if (session.consecutiveAutoResponses > maxConsecutive) {
		responseText = p._SESSION_TERMINATION_TEXT;
		isTermination = true;
		debugLog(
			`[TaskSync] handleResponseTimeout — auto-response limit reached for session ${session.id} (${session.consecutiveAutoResponses}/${maxConsecutive}), terminating session`,
		);
		vscode.window.showWarningMessage(
			`TaskSync: Auto-response limit (${maxConsecutive}) reached. Session terminated after ${timeoutMinutes} min idle.`,
		);
	} else if (session.autopilotEnabled) {
		const prompts = Array.isArray(session.autopilotPrompts)
			? session.autopilotPrompts
			: [];
		if (prompts.length > 0) {
			responseText = prompts[session.autopilotIndex] ?? prompts[0];
			session.autopilotIndex = (session.autopilotIndex + 1) % prompts.length;
		} else {
			const text = session.autopilotText ?? "";
			responseText = settingsH.normalizeAutopilotText(p, text);
		}
		debugLog(
			`[TaskSync] handleResponseTimeout — session ${session.id} autopilot auto-responding with: "${responseText.slice(0, 60)}"`,
		);
		vscode.window.showInformationMessage(
			`TaskSync: Auto-responded after ${timeoutMinutes} min idle. (${session.consecutiveAutoResponses}/${maxConsecutive})`,
		);
	} else {
		responseText = p._SESSION_TERMINATION_TEXT;
		isTermination = true;
		debugLog(
			`[TaskSync] handleResponseTimeout — no autopilot, terminating session after ${timeoutMinutes} min idle`,
		);
		vscode.window.showInformationMessage(
			`TaskSync: Session terminated after ${timeoutMinutes} min idle.`,
		);
	}

	const resolve = p._pendingRequests.get(toolCallId);
	if (resolve) {
		const effectiveResponse = settingsH.applyAutoAppendToResponse(
			p,
			responseText,
			session,
		);
		const pendingEntry = p._currentSessionCallsMap.get(toolCallId);
		if (pendingEntry && pendingEntry.status === "pending") {
			pendingEntry.response = effectiveResponse;
			pendingEntry.status = "completed";
			pendingEntry.timestamp = Date.now();
			pendingEntry.isFromQueue = false;

			if (isSessionActive(p, session.id)) {
				p._view?.webview.postMessage({
					type: "toolCallCompleted",
					entry: pendingEntry,
					sessionTerminated: isTermination,
				} satisfies ToWebviewMessage);
				broadcastToolCallCompleted(p, pendingEntry, isTermination);
			}
		}

		session.pendingToolCallId = null;
		session.waitingOnUser = false;
		session.aiTurnActive = true;
		resolve({
			value: responseText,
			queue: sessionHasQueuedItems(session),
			attachments: [],
		} as UserResponseResult);
		p._pendingRequests.delete(toolCallId);
		p._toolCallSessionMap.delete(toolCallId);
		debugLog(
			`[TaskSync] handleResponseTimeout — resolved with: "${responseText.slice(0, 60)}" for session ${session.id}, isTermination: ${isTermination}`,
		);

		if (isTermination) {
			markSessionTerminated(p, session);
		}
		persistSessionState(p, session);
	}
}
