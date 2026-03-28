/**
 * Tool call handling logic extracted from webviewProvider.ts.
 * Contains waitForUserResponse, timeout handling, and request cancellation.
 */
import * as vscode from "vscode";
import {
	ASKUSER_SUPERSEDED_MESSAGE,
	CONFIG_SECTION,
	DEFAULT_MAX_CONSECUTIVE_AUTO_RESPONSES,
} from "../constants/remoteConstants";

import { isApprovalQuestion, parseChoices } from "./choiceParser";
import * as settingsH from "./settingsHandlers";
import type {
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
	hasQueuedItems,
	markSessionTerminated,
	notifyQueueChanged,
} from "./webviewUtils";

/**
 * Cancel any pending request superseded by a new one.
 */
export function cancelSupersededPendingRequest(p: P): void {
	if (!p._currentToolCallId || !p._pendingRequests.has(p._currentToolCallId)) {
		return;
	}

	debugLog("[TaskSync] Superseding pending request:", p._currentToolCallId);
	if (p._responseTimeoutTimer) {
		clearTimeout(p._responseTimeoutTimer);
		p._responseTimeoutTimer = null;
	}

	const oldToolCallId = p._currentToolCallId;
	const oldResolve = p._pendingRequests.get(oldToolCallId);
	if (oldResolve) {
		oldResolve({
			value: ASKUSER_SUPERSEDED_MESSAGE,
			queue: hasQueuedItems(p),
			attachments: [],
			cancelled: true,
		} as UserResponseResult);
		p._pendingRequests.delete(oldToolCallId);

		const oldEntry = p._currentSessionCallsMap.get(oldToolCallId);
		if (oldEntry && oldEntry.status === "pending") {
			oldEntry.status = "cancelled";
			oldEntry.response = "[Superseded by new request]";
			p._updateCurrentSessionUI();
		}
		console.error(
			`[TaskSync] Previous request ${oldToolCallId} was superseded by new request`,
		);
	}
}

/**
 * Core tool call handler — waits for user response via webview.
 */
export async function waitForUserResponse(
	p: P,
	question: string,
): Promise<UserResponseResult> {
	debugLog(
		"[TaskSync] waitForUserResponse — question:",
		question.slice(0, 80),
		"currentToolCallId:",
		p._currentToolCallId,
		"pendingRequests:",
		p._pendingRequests.size,
	);
	// AI called askUser — it's no longer processing, it's waiting for user input
	p._aiTurnActive = false;

	// Auto-start new session if previous session was terminated
	if (p._sessionTerminated) {
		debugLog(
			"[TaskSync] waitForUserResponse — session was terminated, auto-starting new session",
		);
		p.startNewSession();
	}

	// Start session timer on first tool call
	if (p._sessionStartTime === null) {
		p._sessionStartTime = Date.now();
		p._sessionFrozenElapsed = null;
		p._startSessionTimerInterval();
		p._updateViewTitle();
	}

	if (p._autopilotEnabled && !hasQueuedItems(p)) {
		debugLog(
			"[TaskSync] waitForUserResponse — autopilot enabled, no queue items, auto-responding",
		);
		cancelSupersededPendingRequest(p);

		p._consecutiveAutoResponses++;

		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		const maxConsecutive = config.get<number>(
			"maxConsecutiveAutoResponses",
			DEFAULT_MAX_CONSECUTIVE_AUTO_RESPONSES,
		);

		if (p._consecutiveAutoResponses > maxConsecutive) {
			debugLog(
				`[TaskSync] waitForUserResponse — autopilot limit reached (${p._consecutiveAutoResponses}/${maxConsecutive}), disabling`,
			);
			p._autopilotEnabled = false;
			await config.update(
				"autopilot",
				false,
				vscode.ConfigurationTarget.Workspace,
			);
			p._updateSettingsUI();
			vscode.window.showWarningMessage(
				`TaskSync: Auto-response limit (${maxConsecutive}) reached. Waiting for response or timeout.`,
			);
			// Fall through to pending request flow with timeout timer
		} else {
			const toolCallId = generateId("tc");
			p._currentToolCallId = toolCallId;

			await p._applyHumanLikeDelay("Autopilot");

			if (!p._autopilotEnabled || p._currentToolCallId !== toolCallId) {
				// State changed during delay — fall through
			} else {
				let effectiveText: string;
				if (p._autopilotPrompts.length > 0) {
					effectiveText = p._autopilotPrompts[p._autopilotIndex];
					p._autopilotIndex =
						(p._autopilotIndex + 1) % p._autopilotPrompts.length;
				} else {
					effectiveText = settingsH.normalizeAutopilotText(p, p._autopilotText);
				}
				debugLog(
					`[TaskSync] waitForUserResponse — autopilot auto-responding with: "${effectiveText.slice(0, 60)}" (${p._consecutiveAutoResponses}/${maxConsecutive})`,
				);
				const effectiveResponse = settingsH.applyAutoAppendToResponse(
					p,
					effectiveText,
				);
				vscode.window.showInformationMessage(
					`TaskSync: Autopilot auto-responded. (${p._consecutiveAutoResponses}/${maxConsecutive})`,
				);

				const entry: ToolCallEntry = {
					id: toolCallId,
					prompt: question,
					response: effectiveResponse,
					timestamp: Date.now(),
					isFromQueue: false,
					status: "completed",
				};
				p._currentSessionCalls.unshift(entry);
				p._currentSessionCallsMap.set(entry.id, entry);
				p._updateViewTitle();
				p._updateCurrentSessionUI();
				p._currentToolCallId = null;

				broadcastToolCallCompleted(p, entry);

				return {
					value: effectiveText,
					queue: hasQueuedItems(p),
					attachments: [],
				};
			}
		}
	}

	// If view is not available, open the sidebar first
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

	cancelSupersededPendingRequest(p);

	const toolCallId = generateId("tc");
	p._currentToolCallId = toolCallId;

	// Check if queue has prompts — auto-respond
	if (hasQueuedItems(p)) {
		debugLog(
			`[TaskSync] waitForUserResponse — queue has ${p._promptQueue.length} items, attempting auto-respond from queue`,
		);
		const queuedPrompt = p._promptQueue.shift();
		if (queuedPrompt) {
			notifyQueueChanged(p);

			await p._applyHumanLikeDelay("Queue");

			if (!p._queueEnabled || p._currentToolCallId !== toolCallId) {
				debugLog(
					"[TaskSync] waitForUserResponse — queue disabled or toolCallId changed during delay, re-queuing",
				);
				p._promptQueue.unshift(queuedPrompt);
				notifyQueueChanged(p);
			} else {
				debugLog(
					`[TaskSync] waitForUserResponse — queue auto-responding with: "${queuedPrompt.prompt.slice(0, 60)}"`,
				);
				const effectiveResponse = settingsH.applyAutoAppendToResponse(
					p,
					queuedPrompt.prompt,
				);
				const entry: ToolCallEntry = {
					id: toolCallId,
					prompt: question,
					response: effectiveResponse,
					timestamp: Date.now(),
					isFromQueue: true,
					status: "completed",
				};
				p._currentSessionCalls.unshift(entry);
				p._currentSessionCallsMap.set(entry.id, entry);
				p._updateViewTitle();
				p._updateCurrentSessionUI();
				p._currentToolCallId = null;

				broadcastToolCallCompleted(p, entry);

				return {
					value: queuedPrompt.prompt,
					queue: hasQueuedItems(p),
					attachments: queuedPrompt.attachments || [],
				};
			}
		}
	}

	p._view.show(true);

	debugLog(
		`[TaskSync] waitForUserResponse — creating pending entry, toolCallId: ${toolCallId}, webviewReady: ${p._webviewReady}`,
	);
	// Add pending entry to current session
	const pendingEntry: ToolCallEntry = {
		id: toolCallId,
		prompt: question,
		response: "",
		timestamp: Date.now(),
		isFromQueue: false,
		status: "pending",
	};
	p._currentSessionCalls.unshift(pendingEntry);
	p._currentSessionCallsMap.set(toolCallId, pendingEntry);
	p._updateViewTitle();

	const choices = parseChoices(question);
	const isApproval = choices.length === 0 && isApprovalQuestion(question);

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

	if (p._webviewReady && p._view) {
		debugLog(
			`[TaskSync] waitForUserResponse — posting toolCallPending to webview, id: ${toolCallId}`,
		);
		p._view.webview.postMessage({
			type: "toolCallPending",
			id: toolCallId,
			prompt: question,
			isApproval,
			choices: choices.length > 0 ? choices : undefined,
		} satisfies ToWebviewMessage);
		p.playNotificationSound();
	} else {
		debugLog(
			`[TaskSync] waitForUserResponse — webview not ready, deferring toolCallPending message for id: ${toolCallId}`,
		);
		p._pendingToolCallMessage = {
			id: toolCallId,
			prompt: question,
		};
	}

	debugLog(
		`[TaskSync] waitForUserResponse — broadcasting toolCallPending to remote, id: ${toolCallId}`,
	);
	// Broadcast to remote clients
	p._remoteServer?.broadcast("toolCallPending", {
		id: toolCallId,
		prompt: question,
		isApproval,
		timestamp: Date.now(),
		sessionStartTime: p._sessionStartTime,
		sessionFrozenElapsed: p._sessionFrozenElapsed,
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

	p._updateCurrentSessionUI();

	debugLog(
		`[TaskSync] waitForUserResponse — waiting for user input, toolCallId: ${toolCallId}`,
	);
	return new Promise<UserResponseResult>((resolve) => {
		p._pendingRequests.set(toolCallId, resolve);
		startResponseTimeoutTimer(p, toolCallId);
	});
}

/**
 * Start response timeout timer for a pending tool call.
 */
export function startResponseTimeoutTimer(p: P, toolCallId: string): void {
	if (p._responseTimeoutTimer) {
		clearTimeout(p._responseTimeoutTimer);
		p._responseTimeoutTimer = null;
	}

	const timeoutMinutes = settingsH.readResponseTimeoutMinutes();
	if (timeoutMinutes <= 0) {
		debugLog(
			`[TaskSync] startResponseTimeoutTimer — timeout disabled (${timeoutMinutes} min), no timer set`,
		);
		return;
	}

	const timeoutMs = timeoutMinutes * 60 * 1000;
	debugLog(
		`[TaskSync] startResponseTimeoutTimer — setting ${timeoutMinutes} min timer for toolCallId: ${toolCallId}`,
	);

	p._responseTimeoutTimer = setTimeout(() => {
		handleResponseTimeout(p, toolCallId);
	}, timeoutMs);
}

/**
 * Handle response timeout — auto-respond after user idle.
 */
export async function handleResponseTimeout(
	p: P,
	toolCallId: string,
): Promise<void> {
	debugLog(
		`[TaskSync] handleResponseTimeout — toolCallId: ${toolCallId}, currentToolCallId: ${p._currentToolCallId}`,
	);
	p._responseTimeoutTimer = null;

	if (
		p._currentToolCallId !== toolCallId ||
		!p._pendingRequests.has(toolCallId)
	) {
		debugLog("[TaskSync] handleResponseTimeout — stale timeout, ignoring");
		return;
	}

	await p._applyHumanLikeDelay("Timeout");

	if (
		p._currentToolCallId !== toolCallId ||
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

	p._consecutiveAutoResponses++;
	let responseText: string;
	let isTermination = false;

	if (p._consecutiveAutoResponses > maxConsecutive) {
		responseText = p._SESSION_TERMINATION_TEXT;
		isTermination = true;
		debugLog(
			`[TaskSync] handleResponseTimeout — auto-response limit reached (${p._consecutiveAutoResponses}/${maxConsecutive}), terminating session`,
		);
		vscode.window.showWarningMessage(
			`TaskSync: Auto-response limit (${maxConsecutive}) reached. Session terminated after ${timeoutMinutes} min idle.`,
		);
	} else if (p._autopilotEnabled) {
		responseText = settingsH.normalizeAutopilotText(p, p._autopilotText);
		debugLog(
			`[TaskSync] handleResponseTimeout — autopilot auto-responding with: "${responseText.slice(0, 60)}"`,
		);
		vscode.window.showInformationMessage(
			`TaskSync: Auto-responded after ${timeoutMinutes} min idle. (${p._consecutiveAutoResponses}/${maxConsecutive})`,
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
		);
		const pendingEntry = p._currentSessionCallsMap.get(toolCallId);
		if (pendingEntry && pendingEntry.status === "pending") {
			pendingEntry.response = effectiveResponse;
			pendingEntry.status = "completed";
			pendingEntry.timestamp = Date.now();
			pendingEntry.isFromQueue = false;

			p._view?.webview.postMessage({
				type: "toolCallCompleted",
				entry: pendingEntry,
				sessionTerminated: isTermination,
			} satisfies ToWebviewMessage);

			// Broadcast timeout auto-response to remote clients
			broadcastToolCallCompleted(p, pendingEntry, isTermination);
		}

		p._updateCurrentSessionUI();
		resolve({
			value: responseText,
			queue: hasQueuedItems(p),
			attachments: [],
		} as UserResponseResult);
		p._pendingRequests.delete(toolCallId);
		p._currentToolCallId = null;
		p._aiTurnActive = true; // AI is now processing the timeout auto-response
		debugLog(
			`[TaskSync] handleResponseTimeout — resolved with: "${responseText.slice(0, 60)}", isTermination: ${isTermination}, aiTurnActive: true`,
		);

		if (isTermination) {
			markSessionTerminated(p);
		}
	}
}
