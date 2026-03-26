import type * as vscodeTypes from "vscode";
import {
	AUTO_APPEND_DEFAULT_TEXT,
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
import { applyAutoAppendText, generateId } from "./webviewUtils";

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
	return text.trim().length > 0 ? text : AUTO_APPEND_DEFAULT_TEXT;
}

export function applyAutoAppendToResponse(p: P, response: string): string {
	return applyAutoAppendText(p._autoAppendEnabled, response, p._autoAppendText);
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
	p._soundEnabled = config.get<boolean>("notificationSound", true);
	p._interactiveApprovalEnabled = config.get<boolean>(
		"interactiveApproval",
		true,
	);
	const legacyAutoAppendEnabled = config.get<boolean>(
		"askUserVerbosePayload",
		false,
	);
	p._autoAppendEnabled = config.get<boolean>(
		"autoAppendEnabled",
		legacyAutoAppendEnabled,
	);
	const configuredAutoAppendText = config.get<string>(
		"autoAppendText",
		AUTO_APPEND_DEFAULT_TEXT,
	);
	p._autoAppendText = normalizeAutoAppendText(configuredAutoAppendText);
	p._autopilotEnabled = config.get<boolean>("autopilot", false);

	const defaultAutopilotText = getAutopilotDefaultText(p, config);
	const configuredAutopilotText = config.get<string>(
		"autopilotText",
		defaultAutopilotText,
	);
	p._autopilotText = normalizeAutopilotText(p, configuredAutopilotText, config);

	// Load autopilot prompts array, falling back to autopilotText when empty.
	const savedAutopilotPrompts = config.get<string[]>("autopilotPrompts", []);
	if (savedAutopilotPrompts.length > 0) {
		p._autopilotPrompts = savedAutopilotPrompts.filter(
			(pr: string) => pr.trim().length > 0,
		);
	} else if (p._autopilotText && p._autopilotText !== defaultAutopilotText) {
		p._autopilotPrompts = [p._autopilotText];
	} else {
		p._autopilotPrompts = [];
	}
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
	await withConfigGuard(p, async () => {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		await config.update(
			"autopilotPrompts",
			p._autopilotPrompts,
			vscode.ConfigurationTarget.Global,
		);
	});
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
	p._autoAppendEnabled = enabled;
	await withConfigGuard(p, async () => {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		await config.update(
			"autoAppendEnabled",
			enabled,
			vscode.ConfigurationTarget.Workspace,
		);
	});
}

export async function handleUpdateAutoAppendText(
	p: P,
	text: string,
): Promise<void> {
	const normalizedText = normalizeAutoAppendText(text);
	p._autoAppendText = normalizedText;
	await withConfigGuard(p, async () => {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		await config.update(
			"autoAppendText",
			normalizedText,
			vscode.ConfigurationTarget.Workspace,
		);
	});
}

export async function handleUpdateAutopilotSetting(
	p: P,
	enabled: boolean,
): Promise<void> {
	p._autopilotEnabled = enabled;
	p._consecutiveAutoResponses = 0;
	await withConfigGuard(p, async () => {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		await config.update(
			"autopilot",
			enabled,
			vscode.ConfigurationTarget.Workspace,
		);
	});
	// Remote broadcast handled by onDidChangeConfiguration → broadcastAllSettingsToRemote
}

export async function handleUpdateAutopilotText(
	p: P,
	text: string,
): Promise<void> {
	await withConfigGuard(p, async () => {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		const normalizedText = normalizeAutopilotText(p, text, config);
		p._autopilotText = normalizedText;
		await config.update(
			"autopilotText",
			normalizedText,
			vscode.ConfigurationTarget.Workspace,
		);
	});
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
