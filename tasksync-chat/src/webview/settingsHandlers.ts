import type * as vscodeTypes from "vscode";
import {
	CONFIG_SECTION,
	DEFAULT_HUMAN_LIKE_DELAY_MAX,
	DEFAULT_HUMAN_LIKE_DELAY_MIN,
	DEFAULT_MAX_CONSECUTIVE_AUTO_RESPONSES,
	DEFAULT_REMOTE_MAX_DEVICES,
	DEFAULT_SESSION_WARNING_HOURS,
	HUMAN_DELAY_MAX_LOWER,
	HUMAN_DELAY_MAX_UPPER,
	HUMAN_DELAY_MIN_LOWER,
	HUMAN_DELAY_MIN_UPPER,
	MAX_CONSECUTIVE_AUTO_RESPONSES_LIMIT,
	MIN_REMOTE_MAX_DEVICES,
	RESPONSE_TIMEOUT_ALLOWED_VALUES,
	RESPONSE_TIMEOUT_DEFAULT_MINUTES,
	SESSION_WARNING_HOURS_MAX,
	SESSION_WARNING_HOURS_MIN,
} from "../constants/remoteConstants";
import type { P, ReusablePrompt, ToWebviewMessage } from "./webviewTypes";
import { buildFinalResponseText, generateId } from "./webviewUtils";

let vscode: typeof vscodeTypes;
try {
	vscode = require("vscode");
} catch {
	const mock = (globalThis as { __TASKSYNC_VSCODE_MOCK__?: typeof vscodeTypes })
		.__TASKSYNC_VSCODE_MOCK__;
	if (!mock) {
		throw new Error("VS Code API is unavailable in this runtime.");
	}
	vscode = mock;
}

/**
 * Guard config writes with _isUpdatingConfig flag to prevent re-entry.
 * Catches and logs errors to prevent unhandled promise rejections when
 * called fire-and-forget from the synchronous message router.
 */
async function withConfigGuard(p: P, fn: () => Promise<void>): Promise<void> {
	p._isUpdatingConfig = true;
	try {
		await fn();
	} catch (e) {
		console.error("[TaskSync] Config update failed:", e);
	} finally {
		p._isUpdatingConfig = false;
	}
}

export function getAutopilotDefaultText(
	p: P,
	config?: vscodeTypes.WorkspaceConfiguration,
): string {
	const settings = config ?? vscode.workspace.getConfiguration(CONFIG_SECTION);
	const inspected = settings.inspect<string>("autopilotText");
	const defaultValue =
		typeof inspected?.defaultValue === "string" ? inspected.defaultValue : "";
	return defaultValue.trim().length > 0
		? defaultValue
		: p._AUTOPILOT_DEFAULT_TEXT;
}

export function normalizeAutopilotText(
	p: P,
	text: string,
	config?: vscodeTypes.WorkspaceConfiguration,
): string {
	const defaultAutopilotText = getAutopilotDefaultText(p, config);
	return text.trim().length > 0 ? text : defaultAutopilotText;
}

export function normalizeAutoAppendText(text: string): string {
	return text.trim();
}

/** SSOT: auto-append can only be enabled when normalized text is non-empty. */
export function isAutoAppendTextPresent(text: string): boolean {
	return normalizeAutoAppendText(text).length > 0;
}

export function applyAutoAppendToResponse(p: P, response: string): string {
	return buildFinalResponseText(
		response,
		p._autoAppendEnabled,
		p._autoAppendText,
		p._alwaysAppendReminder,
	);
}

export function normalizeResponseTimeout(value: unknown): number {
	let parsedValue: number;

	if (typeof value === "number") {
		parsedValue = value;
	} else if (typeof value === "string") {
		const normalizedValue = value.trim();
		if (normalizedValue.length === 0) {
			return RESPONSE_TIMEOUT_DEFAULT_MINUTES;
		}
		parsedValue = Number(normalizedValue);
	} else {
		return RESPONSE_TIMEOUT_DEFAULT_MINUTES;
	}

	if (!Number.isFinite(parsedValue) || !Number.isInteger(parsedValue)) {
		return RESPONSE_TIMEOUT_DEFAULT_MINUTES;
	}
	if (!RESPONSE_TIMEOUT_ALLOWED_VALUES.has(parsedValue)) {
		return RESPONSE_TIMEOUT_DEFAULT_MINUTES;
	}
	return parsedValue;
}

export function readResponseTimeoutMinutes(
	config?: vscodeTypes.WorkspaceConfiguration,
): number {
	const settings = config ?? vscode.workspace.getConfiguration(CONFIG_SECTION);
	const configuredTimeout = settings.get<string>(
		"responseTimeout",
		String(RESPONSE_TIMEOUT_DEFAULT_MINUTES),
	);
	return normalizeResponseTimeout(configuredTimeout);
}

export function normalizeRemoteMaxDevices(value: unknown): number {
	let parsedValue: number;

	if (typeof value === "number") {
		parsedValue = value;
	} else if (typeof value === "string") {
		const normalizedValue = value.trim();
		if (normalizedValue.length === 0) {
			return DEFAULT_REMOTE_MAX_DEVICES;
		}
		parsedValue = Number(normalizedValue);
	} else {
		return DEFAULT_REMOTE_MAX_DEVICES;
	}

	if (!Number.isFinite(parsedValue) || !Number.isInteger(parsedValue)) {
		return DEFAULT_REMOTE_MAX_DEVICES;
	}

	return Math.max(MIN_REMOTE_MAX_DEVICES, parsedValue);
}

export function loadSettings(p: P): void {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const activeSession = p._sessionManager?.getActiveSession?.();
	p._soundEnabled = config.get<boolean>("notificationSound", true);
	p._interactiveApprovalEnabled = config.get<boolean>(
		"interactiveApproval",
		true,
	);
	p._autoAppendEnabled = activeSession?.autoAppendEnabled === true;
	p._autoAppendText =
		typeof activeSession?.autoAppendText === "string"
			? normalizeAutoAppendText(activeSession.autoAppendText)
			: "";
	// Auto-disable when text is empty — protects against stale sessions from older versions
	if (p._autoAppendEnabled && !isAutoAppendTextPresent(p._autoAppendText)) {
		p._autoAppendEnabled = false;
		if (activeSession) activeSession.autoAppendEnabled = false;
	}
	p._alwaysAppendReminder = config.get<boolean>(
		"alwaysAppendAskUserReminder",
		false,
	);
	p._autopilotEnabled = activeSession?.autopilotEnabled === true;

	const defaultAutopilotText = getAutopilotDefaultText(p, config);
	p._autopilotText =
		typeof activeSession?.autopilotText === "string" &&
		activeSession.autopilotText.trim().length > 0
			? activeSession.autopilotText
			: defaultAutopilotText;

	p._autopilotPrompts = Array.isArray(activeSession?.autopilotPrompts)
		? activeSession.autopilotPrompts.filter(
				(pr: string) => typeof pr === "string" && pr.trim().length > 0,
			)
		: [];
	if (p._autopilotIndex >= p._autopilotPrompts.length) {
		p._autopilotIndex = 0;
	}

	const savedPrompts = config.get<Array<{ name: string; prompt: string }>>(
		"reusablePrompts",
		[],
	);
	p._reusablePrompts = savedPrompts.map(
		(pr: { name: string; prompt: string }) => ({
			id: generateId("rp"),
			name: pr.name,
			prompt: pr.prompt,
		}),
	);

	// Load human-like delay settings
	p._humanLikeDelayEnabled = config.get<boolean>("humanLikeDelay", true);
	p._humanLikeDelayMin = config.get<number>(
		"humanLikeDelayMin",
		DEFAULT_HUMAN_LIKE_DELAY_MIN,
	);
	p._humanLikeDelayMax = config.get<number>(
		"humanLikeDelayMax",
		DEFAULT_HUMAN_LIKE_DELAY_MAX,
	);
	const configuredWarningHours = config.get<number>(
		"sessionWarningHours",
		DEFAULT_SESSION_WARNING_HOURS,
	);
	p._sessionWarningHours = Number.isFinite(configuredWarningHours)
		? Math.min(
				SESSION_WARNING_HOURS_MAX,
				Math.max(SESSION_WARNING_HOURS_MIN, Math.floor(configuredWarningHours)),
			)
		: DEFAULT_SESSION_WARNING_HOURS;
	p._sendWithCtrlEnter = config.get<boolean>("sendWithCtrlEnter", false);
	// Ensure min <= max
	if (p._humanLikeDelayMin > p._humanLikeDelayMax) {
		p._humanLikeDelayMin = p._humanLikeDelayMax;
	}
}

export async function saveReusablePrompts(p: P): Promise<void> {
	const promptsToSave = p._reusablePrompts.map((pr: ReusablePrompt) => ({
		name: pr.name,
		prompt: pr.prompt,
	}));
	await withConfigGuard(p, async () => {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		await config.update(
			"reusablePrompts",
			promptsToSave,
			vscode.ConfigurationTarget.Global,
		);
	});
}

/** Build canonical settings payload — SSOT for all settings fields. */
export function buildSettingsPayload(p: P): {
	soundEnabled: boolean;
	interactiveApprovalEnabled: boolean;
	autoAppendEnabled: boolean;
	autoAppendText: string;
	alwaysAppendReminder: boolean;
	sendWithCtrlEnter: boolean;
	autopilotEnabled: boolean;
	autopilotText: string;
	autopilotPrompts: string[];
	reusablePrompts: ReusablePrompt[];
	responseTimeout: number;
	sessionWarningHours: number;
	maxConsecutiveAutoResponses: number;
	remoteMaxDevices: number;
	humanLikeDelayEnabled: boolean;
	humanLikeDelayMin: number;
	humanLikeDelayMax: number;
	queueEnabled: boolean;
} {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return {
		soundEnabled: p._soundEnabled,
		interactiveApprovalEnabled: p._interactiveApprovalEnabled,
		autoAppendEnabled: p._autoAppendEnabled,
		autoAppendText: p._autoAppendText,
		alwaysAppendReminder: p._alwaysAppendReminder,
		sendWithCtrlEnter: p._sendWithCtrlEnter,
		autopilotEnabled: p._autopilotEnabled,
		autopilotText: p._autopilotText,
		autopilotPrompts: p._autopilotPrompts,
		reusablePrompts: p._reusablePrompts,
		responseTimeout: readResponseTimeoutMinutes(config),
		sessionWarningHours: p._sessionWarningHours,
		maxConsecutiveAutoResponses: config.get<number>(
			"maxConsecutiveAutoResponses",
			DEFAULT_MAX_CONSECUTIVE_AUTO_RESPONSES,
		),
		remoteMaxDevices: normalizeRemoteMaxDevices(
			config.get<number>("remoteMaxDevices", DEFAULT_REMOTE_MAX_DEVICES),
		),
		humanLikeDelayEnabled: p._humanLikeDelayEnabled,
		humanLikeDelayMin: p._humanLikeDelayMin,
		humanLikeDelayMax: p._humanLikeDelayMax,
		queueEnabled: p._queueEnabled,
	};
}

export function updateSettingsUI(p: P): void {
	const payload = buildSettingsPayload(p);
	p._view?.webview.postMessage({
		type: "updateSettings",
		...payload,
	} satisfies ToWebviewMessage);
}

/** Broadcast ALL current settings to remote clients. */
export function broadcastAllSettingsToRemote(p: P): void {
	if (!p._remoteServer) return;
	p._remoteServer.broadcast("settingsChanged", buildSettingsPayload(p));
}

export async function saveAutopilotPrompts(p: P): Promise<void> {
	const session = p._sessionManager?.getActiveSession?.();
	if (!session) return;
	session.autopilotPrompts = [...p._autopilotPrompts];
	p._saveSessionsToDisk?.();
}

export async function handleUpdateSoundSetting(
	p: P,
	enabled: boolean,
): Promise<void> {
	p._soundEnabled = enabled;
	await withConfigGuard(p, async () => {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		await config.update(
			"notificationSound",
			enabled,
			vscode.ConfigurationTarget.Global,
		);
	});
}

export async function handleUpdateInteractiveApprovalSetting(
	p: P,
	enabled: boolean,
): Promise<void> {
	p._interactiveApprovalEnabled = enabled;
	await withConfigGuard(p, async () => {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		await config.update(
			"interactiveApproval",
			enabled,
			vscode.ConfigurationTarget.Global,
		);
	});
}

export async function handleUpdateAutoAppendSetting(
	p: P,
	enabled: boolean,
): Promise<void> {
	const activeSession = p._sessionManager?.getActiveSession?.();
	// Auto-disable when text is empty — nothing to append
	const effectiveEnabled =
		enabled &&
		isAutoAppendTextPresent(
			activeSession?.autoAppendText ?? p._autoAppendText ?? "",
		);
	p._autoAppendEnabled = effectiveEnabled;
	if (activeSession) {
		activeSession.autoAppendEnabled = effectiveEnabled;
		p._saveSessionsToDisk?.();
	}
	updateSettingsUI(p);
	sendSessionSettingsToWebview(p);
	broadcastAllSettingsToRemote(p);
}

export async function handleUpdateAutoAppendText(
	p: P,
	text: string,
): Promise<void> {
	const normalizedText = normalizeAutoAppendText(text);
	p._autoAppendText = normalizedText;
	const activeSession = p._sessionManager?.getActiveSession?.();
	if (activeSession) {
		activeSession.autoAppendText = normalizedText;
		// Auto-disable when text is cleared
		if (
			!isAutoAppendTextPresent(normalizedText) &&
			activeSession.autoAppendEnabled
		) {
			activeSession.autoAppendEnabled = false;
			p._autoAppendEnabled = false;
		}
		p._saveSessionsToDisk?.();
	}
	updateSettingsUI(p);
	sendSessionSettingsToWebview(p);
	broadcastAllSettingsToRemote(p);
}

export async function handleUpdateAlwaysAppendReminderSetting(
	p: P,
	enabled: boolean,
): Promise<void> {
	p._alwaysAppendReminder = enabled;
	await withConfigGuard(p, async () => {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		await config.update(
			"alwaysAppendAskUserReminder",
			enabled,
			vscode.ConfigurationTarget.Global,
		);
	});
	updateSettingsUI(p);
	broadcastAllSettingsToRemote(p);
}

export function handleUpdateAutopilotSetting(p: P, enabled: boolean): void {
	p._autopilotEnabled = enabled;
	p._consecutiveAutoResponses = 0;
	const activeSession = p._sessionManager?.getActiveSession?.();
	if (activeSession) {
		activeSession.autopilotEnabled = enabled;
		activeSession.consecutiveAutoResponses = 0;
		p._saveSessionsToDisk?.();
	}
	updateSettingsUI(p);
	sendSessionSettingsToWebview(p);
	broadcastAllSettingsToRemote(p);
}

export async function handleUpdateAutopilotText(
	p: P,
	text: string,
): Promise<void> {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const normalizedText = normalizeAutopilotText(p, text, config);
	p._autopilotText = normalizedText;
	const activeSession = p._sessionManager?.getActiveSession?.();
	if (activeSession) {
		activeSession.autopilotText = normalizedText;
		p._saveSessionsToDisk?.();
	}
	updateSettingsUI(p);
	sendSessionSettingsToWebview(p);
	broadcastAllSettingsToRemote(p);
}

export async function handleAddAutopilotPrompt(
	p: P,
	prompt: string,
): Promise<void> {
	const trimmedPrompt = prompt.trim();
	if (!trimmedPrompt) return;
	p._autopilotPrompts.push(trimmedPrompt);
	await saveAutopilotPrompts(p);
	updateSettingsUI(p);
	sendSessionSettingsToWebview(p);
	broadcastAllSettingsToRemote(p);
}

export async function handleEditAutopilotPrompt(
	p: P,
	index: number,
	prompt: string,
): Promise<void> {
	const trimmedPrompt = prompt.trim();
	if (!trimmedPrompt || index < 0 || index >= p._autopilotPrompts.length)
		return;
	p._autopilotPrompts[index] = trimmedPrompt;
	await saveAutopilotPrompts(p);
	updateSettingsUI(p);
	sendSessionSettingsToWebview(p);
	broadcastAllSettingsToRemote(p);
}

export async function handleRemoveAutopilotPrompt(
	p: P,
	index: number,
): Promise<void> {
	if (index < 0 || index >= p._autopilotPrompts.length) return;
	p._autopilotPrompts.splice(index, 1);
	if (p._autopilotIndex > index) {
		p._autopilotIndex--;
	} else if (p._autopilotIndex >= p._autopilotPrompts.length) {
		p._autopilotIndex = 0;
	}
	await saveAutopilotPrompts(p);
	updateSettingsUI(p);
	sendSessionSettingsToWebview(p);
	broadcastAllSettingsToRemote(p);
}

export async function handleReorderAutopilotPrompts(
	p: P,
	fromIndex: number,
	toIndex: number,
): Promise<void> {
	if (
		fromIndex < 0 ||
		fromIndex >= p._autopilotPrompts.length ||
		toIndex < 0 ||
		toIndex >= p._autopilotPrompts.length ||
		fromIndex === toIndex
	) {
		return;
	}

	if (p._autopilotIndex === fromIndex) {
		p._autopilotIndex = toIndex;
	} else if (fromIndex < p._autopilotIndex && toIndex >= p._autopilotIndex) {
		p._autopilotIndex--;
	} else if (fromIndex > p._autopilotIndex && toIndex <= p._autopilotIndex) {
		p._autopilotIndex++;
	}

	const [removed] = p._autopilotPrompts.splice(fromIndex, 1);
	p._autopilotPrompts.splice(toIndex, 0, removed);
	await saveAutopilotPrompts(p);
	updateSettingsUI(p);
	sendSessionSettingsToWebview(p);
	broadcastAllSettingsToRemote(p);
}

/** Replace the entire autopilot prompts array (bulk save from shared UI). */
export async function handleSaveAutopilotPrompts(
	p: P,
	prompts: string[],
): Promise<void> {
	p._autopilotPrompts = prompts.filter(
		(s) => typeof s === "string" && s.trim().length > 0,
	);
	// Reset index if out of bounds
	if (p._autopilotIndex >= p._autopilotPrompts.length) {
		p._autopilotIndex = 0;
	}
	await saveAutopilotPrompts(p);
	updateSettingsUI(p);
	sendSessionSettingsToWebview(p);
	broadcastAllSettingsToRemote(p);
}

export async function handleUpdateResponseTimeout(
	p: P,
	value: number,
): Promise<void> {
	await withConfigGuard(p, async () => {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		await config.update(
			"responseTimeout",
			String(normalizeResponseTimeout(value)),
			vscode.ConfigurationTarget.Workspace,
		);
	});
}

export async function handleUpdateSessionWarningHours(
	p: P,
	value: number,
): Promise<void> {
	if (!Number.isFinite(value)) return;
	const normalizedValue = Math.min(
		SESSION_WARNING_HOURS_MAX,
		Math.max(SESSION_WARNING_HOURS_MIN, Math.floor(value)),
	);
	p._sessionWarningHours = normalizedValue;
	await withConfigGuard(p, async () => {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		await config.update(
			"sessionWarningHours",
			normalizedValue,
			vscode.ConfigurationTarget.Workspace,
		);
	});
}

export async function handleUpdateMaxConsecutiveAutoResponses(
	p: P,
	value: number,
): Promise<void> {
	if (!Number.isFinite(value)) return;
	const clamped = Math.min(
		MAX_CONSECUTIVE_AUTO_RESPONSES_LIMIT,
		Math.max(1, Math.floor(value)),
	);
	await withConfigGuard(p, async () => {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		await config.update(
			"maxConsecutiveAutoResponses",
			clamped,
			vscode.ConfigurationTarget.Workspace,
		);
	});
}

export async function handleUpdateRemoteMaxDevices(
	p: P,
	value: number,
): Promise<void> {
	if (!Number.isFinite(value)) return;
	const normalized = Math.max(MIN_REMOTE_MAX_DEVICES, Math.floor(value));
	await withConfigGuard(p, async () => {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		await config.update(
			"remoteMaxDevices",
			normalized,
			vscode.ConfigurationTarget.Global,
		);
	});
}

export async function handleUpdateHumanDelaySetting(
	p: P,
	enabled: boolean,
): Promise<void> {
	p._humanLikeDelayEnabled = enabled;
	await withConfigGuard(p, async () => {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		await config.update(
			"humanLikeDelay",
			enabled,
			vscode.ConfigurationTarget.Workspace,
		);
	});
}

export async function handleUpdateHumanDelayMin(
	p: P,
	value: number,
): Promise<void> {
	if (value >= HUMAN_DELAY_MIN_LOWER && value <= HUMAN_DELAY_MIN_UPPER) {
		p._humanLikeDelayMin = value;
		let adjustedMax = false;
		if (p._humanLikeDelayMin > p._humanLikeDelayMax) {
			p._humanLikeDelayMax = p._humanLikeDelayMin;
			adjustedMax = true;
		}
		await withConfigGuard(p, async () => {
			const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
			await config.update(
				"humanLikeDelayMin",
				value,
				vscode.ConfigurationTarget.Workspace,
			);
			if (adjustedMax) {
				await config.update(
					"humanLikeDelayMax",
					p._humanLikeDelayMax,
					vscode.ConfigurationTarget.Workspace,
				);
			}
		});
	}
}

export async function handleUpdateHumanDelayMax(
	p: P,
	value: number,
): Promise<void> {
	if (value >= HUMAN_DELAY_MAX_LOWER && value <= HUMAN_DELAY_MAX_UPPER) {
		p._humanLikeDelayMax = value;
		let adjustedMin = false;
		if (p._humanLikeDelayMax < p._humanLikeDelayMin) {
			p._humanLikeDelayMin = p._humanLikeDelayMax;
			adjustedMin = true;
		}
		await withConfigGuard(p, async () => {
			const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
			await config.update(
				"humanLikeDelayMax",
				value,
				vscode.ConfigurationTarget.Workspace,
			);
			if (adjustedMin) {
				await config.update(
					"humanLikeDelayMin",
					p._humanLikeDelayMin,
					vscode.ConfigurationTarget.Workspace,
				);
			}
		});
	}
}

export async function handleUpdateSendWithCtrlEnterSetting(
	p: P,
	enabled: boolean,
): Promise<void> {
	p._sendWithCtrlEnter = enabled;
	await withConfigGuard(p, async () => {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		await config.update(
			"sendWithCtrlEnter",
			enabled,
			vscode.ConfigurationTarget.Global,
		);
	});
}

export async function handleAddReusablePrompt(
	p: P,
	name: string,
	prompt: string,
): Promise<void> {
	const trimmedName = name.trim().toLowerCase().replace(/\s+/g, "-");
	const trimmedPrompt = prompt.trim();
	if (!trimmedName || !trimmedPrompt) return;

	if (
		p._reusablePrompts.some(
			(pr: ReusablePrompt) => pr.name.toLowerCase() === trimmedName,
		)
	) {
		vscode.window.showWarningMessage(
			`A prompt with name "/${trimmedName}" already exists.`,
		);
		return;
	}

	const newPrompt: ReusablePrompt = {
		id: generateId("rp"),
		name: trimmedName,
		prompt: trimmedPrompt,
	};
	p._reusablePrompts.push(newPrompt);
	await saveReusablePrompts(p);
	updateSettingsUI(p);
}

export async function handleEditReusablePrompt(
	p: P,
	id: string,
	name: string,
	prompt: string,
): Promise<void> {
	const trimmedName = name.trim().toLowerCase().replace(/\s+/g, "-");
	const trimmedPrompt = prompt.trim();
	if (!trimmedName || !trimmedPrompt) return;

	const existingPrompt = p._reusablePrompts.find(
		(pr: ReusablePrompt) => pr.id === id,
	);
	if (!existingPrompt) return;

	if (
		p._reusablePrompts.some(
			(pr: ReusablePrompt) =>
				pr.id !== id && pr.name.toLowerCase() === trimmedName,
		)
	) {
		vscode.window.showWarningMessage(
			`A prompt with name "/${trimmedName}" already exists.`,
		);
		return;
	}

	existingPrompt.name = trimmedName;
	existingPrompt.prompt = trimmedPrompt;
	await saveReusablePrompts(p);
	updateSettingsUI(p);
}

export async function handleRemoveReusablePrompt(
	p: P,
	id: string,
): Promise<void> {
	p._reusablePrompts = p._reusablePrompts.filter(
		(pr: ReusablePrompt) => pr.id !== id,
	);
	await saveReusablePrompts(p);
	updateSettingsUI(p);
}

export function handleSearchSlashCommands(p: P, query: string): void {
	const queryLower = query.toLowerCase();
	const matchingPrompts = p._reusablePrompts.filter(
		(pr: ReusablePrompt) =>
			pr.name.toLowerCase().includes(queryLower) ||
			pr.prompt.toLowerCase().includes(queryLower),
	);
	p._view?.webview.postMessage({
		type: "slashCommandResults",
		prompts: matchingPrompts,
	} satisfies ToWebviewMessage);
}

// ========== Per-Session Settings ==========

/** Build the per-session settings state payload for the webview. */
export function buildSessionSettingsPayload(p: P): {
	type: "sessionSettingsState";
	autopilotEnabled: boolean;
	autopilotPrompts: string[];
	autoAppendEnabled: boolean;
	autoAppendText: string;
	workspaceDefaultAutoAppendText: string;
	isDefault: boolean;
} {
	const session = p._sessionManager?.getActiveSession?.();

	// Current effective values
	const autopilotEnabled = p._autopilotEnabled;
	const autopilotPrompts = p._autopilotPrompts;
	const autoAppendEnabled = p._autoAppendEnabled;
	const autoAppendText = p._autoAppendText;

	const isDefault =
		!session ||
		(session.autopilotEnabled !== true &&
			(!Array.isArray(session.autopilotPrompts) ||
				session.autopilotPrompts.length === 0) &&
			session.autoAppendEnabled !== true &&
			normalizeAutoAppendText(session.autoAppendText ?? "").length === 0);

	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const workspaceDefaultAutoAppendText = normalizeAutoAppendText(
		config.get<string>("autoAppendText", "") ?? "",
	);

	return {
		type: "sessionSettingsState",
		autopilotEnabled,
		autopilotPrompts,
		autoAppendEnabled,
		autoAppendText,
		workspaceDefaultAutoAppendText,
		isDefault,
	} satisfies ToWebviewMessage;
}

/** Send per-session settings state to the webview. */
export function sendSessionSettingsToWebview(p: P): void {
	p._view?.webview.postMessage(buildSessionSettingsPayload(p));
}

/**
 * Handle per-session settings update from the webview.
 * Writes ONLY to the session object — does NOT touch workspace config.
 */
export function handleUpdateSessionSettings(
	p: P,
	msg: {
		autopilotEnabled?: boolean;
		autopilotPrompts?: string[];
		autoAppendEnabled?: boolean;
		autoAppendText?: string;
	},
): void {
	const session = p._sessionManager?.getActiveSession?.();
	if (!session) return;

	if (msg.autopilotEnabled !== undefined) {
		session.autopilotEnabled = msg.autopilotEnabled;
		p._autopilotEnabled = msg.autopilotEnabled;
		p._consecutiveAutoResponses = 0;
		session.consecutiveAutoResponses = 0;
	}
	if (msg.autopilotPrompts !== undefined) {
		const cleaned = msg.autopilotPrompts.filter(
			(pr: string) => pr.trim().length > 0,
		);
		session.autopilotPrompts = cleaned;
		p._autopilotPrompts = [...cleaned];
		if (p._autopilotIndex >= cleaned.length) {
			p._autopilotIndex = 0;
		}
	}
	if (msg.autoAppendText !== undefined) {
		const normalized = normalizeAutoAppendText(msg.autoAppendText);
		session.autoAppendText = normalized;
		p._autoAppendText = normalized;
	}
	if (msg.autoAppendEnabled !== undefined) {
		// Auto-disable when text is empty — nothing to append
		const effectiveEnabled =
			msg.autoAppendEnabled &&
			isAutoAppendTextPresent(session.autoAppendText ?? "");
		session.autoAppendEnabled = effectiveEnabled;
		p._autoAppendEnabled = effectiveEnabled;
	}

	p._saveSessionsToDisk?.();
	// Send updated global settings UI (keeps the global modal in sync)
	updateSettingsUI(p);
	// Send per-session state back
	sendSessionSettingsToWebview(p);
	broadcastAllSettingsToRemote(p);
}

/**
 * Reset all per-session settings to TaskSync defaults.
 */
export function handleResetSessionSettings(p: P): void {
	const session = p._sessionManager?.getActiveSession?.();
	if (!session) return;

	const config = vscode?.workspace?.getConfiguration?.(CONFIG_SECTION);
	session.autopilotEnabled = false;
	session.autopilotText = undefined;
	session.autopilotPrompts = [];
	const resetText = normalizeAutoAppendText(
		config?.get<string>("autoAppendText", "") ?? "",
	);
	session.autoAppendEnabled = false;
	session.autoAppendText = resetText;

	loadSettings(p);
	p._saveSessionsToDisk?.();
	updateSettingsUI(p);
	sendSessionSettingsToWebview(p);
	broadcastAllSettingsToRemote(p);
}

/**
 * Persist current session's auto-append text as the workspace-level default
 * for new sessions. Only the text is saved — new sessions always start with
 * auto-append disabled so the user explicitly opts in each time.
 */
export async function handleSaveAutoAppendAsWorkspaceDefault(
	p: P,
): Promise<void> {
	const session = p._sessionManager?.getActiveSession?.();
	if (!session) return;

	await withConfigGuard(p, async () => {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		await config.update(
			"autoAppendText",
			session.autoAppendText ?? "",
			vscode.ConfigurationTarget.Workspace,
		);
	});
}
