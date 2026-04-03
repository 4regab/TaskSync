/**
 * Remote settings message dispatcher.
 * Routes settings-related WebSocket messages to the provider's settings handlers.
 */
import type { WebSocket } from "ws";
import { ErrorCode } from "../constants/remoteConstants";
import * as settingsH from "../webview/settingsHandlers";
import type { P } from "../webview/webviewTypes";
import { sendWsError } from "./serverUtils";

/**
 * Dispatch a settings message from a remote client.
 * Returns true if the message was handled, false otherwise.
 */
export async function dispatchSettingsMessage(
	ws: WebSocket,
	provider: P,
	broadcastFn: (type: string, data: unknown) => void,
	msg: { type: string; [key: string]: unknown },
): Promise<boolean> {
	switch (msg.type) {
		case "updateSoundSetting":
			await settingsH.handleUpdateSoundSetting(provider, msg.enabled === true);
			broadcastSettingsChanged(provider, broadcastFn);
			return true;

		case "updateInteractiveApprovalSetting":
			await settingsH.handleUpdateInteractiveApprovalSetting(
				provider,
				msg.enabled === true,
			);
			broadcastSettingsChanged(provider, broadcastFn);
			return true;

		case "updateAgentOrchestrationSetting":
			await settingsH.handleUpdateAgentOrchestrationSetting(
				provider,
				msg.enabled === true,
			);
			return true;

		case "disableAgentOrchestrationAndStopSessions":
			await settingsH.handleStopSessionsAndDisableAgentOrchestration(provider);
			return true;

		case "updateAutoAppendSetting":
			await settingsH.handleUpdateAutoAppendSetting(
				provider,
				msg.enabled === true,
			);
			broadcastSettingsChanged(provider, broadcastFn);
			return true;

		case "updateAutoAppendText": {
			const text = typeof msg.text === "string" ? msg.text : "";
			await settingsH.handleUpdateAutoAppendText(provider, text);
			broadcastSettingsChanged(provider, broadcastFn);
			return true;
		}

		case "updateSendWithCtrlEnterSetting":
			await settingsH.handleUpdateSendWithCtrlEnterSetting(
				provider,
				msg.enabled === true,
			);
			broadcastSettingsChanged(provider, broadcastFn);
			return true;

		case "updateHumanDelaySetting":
			await settingsH.handleUpdateHumanDelaySetting(
				provider,
				msg.enabled === true,
			);
			broadcastSettingsChanged(provider, broadcastFn);
			return true;

		case "updateHumanDelayMin": {
			const val = Number(msg.value);
			if (!Number.isFinite(val)) {
				sendWsError(ws, "Invalid value", ErrorCode.INVALID_INPUT);
				return true;
			}
			await settingsH.handleUpdateHumanDelayMin(provider, val);
			broadcastSettingsChanged(provider, broadcastFn);
			return true;
		}

		case "updateHumanDelayMax": {
			const val = Number(msg.value);
			if (!Number.isFinite(val)) {
				sendWsError(ws, "Invalid value", ErrorCode.INVALID_INPUT);
				return true;
			}
			await settingsH.handleUpdateHumanDelayMax(provider, val);
			broadcastSettingsChanged(provider, broadcastFn);
			return true;
		}

		case "updateSessionWarningHours": {
			const val = Number(msg.value);
			if (!Number.isFinite(val)) {
				sendWsError(ws, "Invalid value", ErrorCode.INVALID_INPUT);
				return true;
			}
			await settingsH.handleUpdateSessionWarningHours(provider, val);
			broadcastSettingsChanged(provider, broadcastFn);
			return true;
		}

		case "updateMaxConsecutiveAutoResponses": {
			const val = Number(msg.value);
			if (!Number.isFinite(val)) {
				sendWsError(ws, "Invalid value", ErrorCode.INVALID_INPUT);
				return true;
			}
			await settingsH.handleUpdateMaxConsecutiveAutoResponses(provider, val);
			broadcastSettingsChanged(provider, broadcastFn);
			return true;
		}

		case "updateRemoteMaxDevices": {
			const val = Number(msg.value);
			if (!Number.isFinite(val)) {
				sendWsError(ws, "Invalid value", ErrorCode.INVALID_INPUT);
				return true;
			}
			await settingsH.handleUpdateRemoteMaxDevices(provider, val);
			broadcastSettingsChanged(provider, broadcastFn);
			return true;
		}

		case "updateAutopilotText": {
			const text = typeof msg.text === "string" ? msg.text : "";
			await settingsH.handleUpdateAutopilotText(provider, text);
			broadcastSettingsChanged(provider, broadcastFn);
			return true;
		}

		case "addAutopilotPrompt": {
			const prompt = typeof msg.prompt === "string" ? msg.prompt : "";
			if (!prompt.trim()) {
				sendWsError(ws, "Empty prompt", ErrorCode.INVALID_INPUT);
				return true;
			}
			await settingsH.handleAddAutopilotPrompt(provider, prompt);
			broadcastSettingsChanged(provider, broadcastFn);
			return true;
		}

		case "editAutopilotPrompt": {
			const index = Number(msg.index);
			const prompt = typeof msg.prompt === "string" ? msg.prompt : "";
			if (!Number.isInteger(index) || index < 0 || !prompt.trim()) {
				sendWsError(ws, "Invalid input", ErrorCode.INVALID_INPUT);
				return true;
			}
			await settingsH.handleEditAutopilotPrompt(provider, index, prompt);
			broadcastSettingsChanged(provider, broadcastFn);
			return true;
		}

		case "removeAutopilotPrompt": {
			const index = Number(msg.index);
			if (!Number.isInteger(index) || index < 0) {
				sendWsError(ws, "Invalid index", ErrorCode.INVALID_INPUT);
				return true;
			}
			await settingsH.handleRemoveAutopilotPrompt(provider, index);
			broadcastSettingsChanged(provider, broadcastFn);
			return true;
		}

		case "reorderAutopilotPrompts": {
			const from = Number(msg.fromIndex);
			const to = Number(msg.toIndex);
			if (
				!Number.isInteger(from) ||
				from < 0 ||
				!Number.isInteger(to) ||
				to < 0
			) {
				sendWsError(ws, "Invalid indices", ErrorCode.INVALID_INPUT);
				return true;
			}
			await settingsH.handleReorderAutopilotPrompts(provider, from, to);
			broadcastSettingsChanged(provider, broadcastFn);
			return true;
		}

		case "addReusablePrompt": {
			const name = typeof msg.name === "string" ? msg.name : "";
			const prompt = typeof msg.prompt === "string" ? msg.prompt : "";
			if (!name.trim() || !prompt.trim()) {
				sendWsError(ws, "Name and prompt required", ErrorCode.INVALID_INPUT);
				return true;
			}
			await settingsH.handleAddReusablePrompt(provider, name, prompt);
			broadcastSettingsChanged(provider, broadcastFn);
			return true;
		}

		case "editReusablePrompt": {
			const id = typeof msg.id === "string" ? msg.id : "";
			const name = typeof msg.name === "string" ? msg.name : "";
			const prompt = typeof msg.prompt === "string" ? msg.prompt : "";
			if (!id || !name.trim() || !prompt.trim()) {
				sendWsError(ws, "Invalid input", ErrorCode.INVALID_INPUT);
				return true;
			}
			await settingsH.handleEditReusablePrompt(provider, id, name, prompt);
			broadcastSettingsChanged(provider, broadcastFn);
			return true;
		}

		case "removeReusablePrompt": {
			const id = typeof msg.id === "string" ? msg.id : "";
			if (!id) {
				sendWsError(ws, "Missing prompt ID", ErrorCode.INVALID_INPUT);
				return true;
			}
			await settingsH.handleRemoveReusablePrompt(provider, id);
			broadcastSettingsChanged(provider, broadcastFn);
			return true;
		}

		case "searchSlashCommands": {
			const query = typeof msg.query === "string" ? msg.query : "";
			const queryLower = query.toLowerCase();
			const results = provider._reusablePrompts.filter(
				(rp: { name: string; prompt: string }) =>
					rp.name.toLowerCase().includes(queryLower) ||
					rp.prompt.toLowerCase().includes(queryLower),
			);
			try {
				ws.send(
					JSON.stringify({ type: "slashCommandResults", prompts: results }),
				);
			} catch {
				/* ignore */
			}
			return true;
		}

		default:
			return false;
	}
}

/** Broadcast all current settings to remote clients after a change. Uses SSOT payload builder. */
function broadcastSettingsChanged(
	provider: P,
	broadcastFn: (type: string, data: unknown) => void,
): void {
	broadcastFn("settingsChanged", settingsH.buildSettingsPayload(provider));
}
