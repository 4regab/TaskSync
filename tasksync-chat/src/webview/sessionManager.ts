/**
 * Session timer and human-like delay logic extracted from webviewProvider.ts.
 */
import * as vscode from "vscode";

import type { P, ToWebviewMessage } from "./webviewTypes";
import { debugLog, getHumanLikeDelayMs } from "./webviewUtils";

/**
 * Apply a random human-like delay before an automated response.
 */
export async function applyHumanLikeDelay(p: P, label?: string): Promise<void> {
	const delayMs = getHumanLikeDelayMs(
		p._humanLikeDelayEnabled,
		p._humanLikeDelayMin,
		p._humanLikeDelayMax,
	);
	if (delayMs > 0) {
		const delaySec = (delayMs / 1000).toFixed(1);
		debugLog(
			`[TaskSync] applyHumanLikeDelay â€” ${label || ""} waiting ${delaySec}s`,
		);
		if (label) {
			vscode.window.setStatusBarMessage(
				`TaskSync: ${label} responding in ${delaySec}s...`,
				delayMs,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
}

/**
 * Update the view title and webview with current session timer state.
 */
export function updateViewTitle(p: P): void {
	if (p._view) {
		p._view.title = undefined;
		p._view.description = undefined;
		p._view.badge = undefined;
		p._view.webview.postMessage({
			type: "updateSessionTimer",
			startTime: p._sessionStartTime,
			frozenElapsed: p._sessionFrozenElapsed,
		} satisfies ToWebviewMessage);
	}
}

/**
 * Start the session timer interval that updates every second.
 */
export function startSessionTimerInterval(p: P): void {
	if (p._sessionTimerInterval) return; // Already running
	debugLog(
		`[TaskSync] startSessionTimerInterval â€” starting timer, sessionStartTime: ${p._sessionStartTime}`,
	);
	p._sessionTimerInterval = setInterval(() => {
		if (p._sessionStartTime !== null && p._sessionFrozenElapsed === null) {
			const elapsed = Date.now() - p._sessionStartTime;
			const warningThresholdMs = p._sessionWarningHours * 60 * 60 * 1000;
			if (
				p._sessionWarningHours > 0 &&
				!p._sessionWarningShown &&
				elapsed >= warningThresholdMs
			) {
				p._sessionWarningShown = true;
				const activeSession = p._sessionManager?.getActiveSession?.();
				if (activeSession) {
					activeSession.sessionWarningShown = true;
				}
				const callCount = p._currentSessionCalls.length;
				const hoursLabel = p._sessionWarningHours === 1 ? "hour" : "hours";
				vscode.window
					.showWarningMessage(
						`Your session has been running for over ${p._sessionWarningHours} ${hoursLabel} (${callCount} tool calls). Consider starting a new session to maintain quality.`,
						"New Session",
						"Dismiss",
					)
					.then((action: string | undefined) => {
						if (action === "New Session") {
							p.startNewSession();
						}
					});
			}
		}
	}, 1000);
}

/**
 * Stop the session timer interval.
 */
export function stopSessionTimerInterval(p: P): void {
	if (p._sessionTimerInterval) {
		debugLog("[TaskSync] stopSessionTimerInterval â€” stopping timer");
		clearInterval(p._sessionTimerInterval);
		p._sessionTimerInterval = null;
	}
}
