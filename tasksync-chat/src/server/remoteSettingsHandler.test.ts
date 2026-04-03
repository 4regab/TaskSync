import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import "../__mocks__/vscode";
import * as settingsH from "../webview/settingsHandlers";
import { dispatchSettingsMessage } from "./remoteSettingsHandler";

describe("dispatchSettingsMessage", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("handles updateAgentOrchestrationSetting and broadcasts updated settings", async () => {
		const ws = { send: vi.fn() } as unknown as WebSocket;
		const provider = {} as any;
		const broadcast = vi.fn();
		const payload = { agentOrchestrationEnabled: false };

		const updateSpy = vi
			.spyOn(settingsH, "handleUpdateAgentOrchestrationSetting")
			.mockResolvedValue(undefined);
		vi.spyOn(settingsH, "buildSettingsPayload").mockReturnValue(payload as any);

		const handled = await dispatchSettingsMessage(ws, provider, broadcast, {
			type: "updateAgentOrchestrationSetting",
			enabled: false,
		});

		expect(handled).toBe(true);
		expect(updateSpy).toHaveBeenCalledWith(provider, false);
		expect(broadcast).toHaveBeenCalledWith("settingsChanged", payload);
	});

	it("handles disableAgentOrchestrationAndStopSessions and broadcasts updated settings", async () => {
		const ws = { send: vi.fn() } as unknown as WebSocket;
		const provider = {} as any;
		const broadcast = vi.fn();
		const payload = { agentOrchestrationEnabled: false };

		const stopSpy = vi
			.spyOn(settingsH, "handleStopSessionsAndDisableAgentOrchestration")
			.mockResolvedValue(undefined);
		vi.spyOn(settingsH, "buildSettingsPayload").mockReturnValue(payload as any);

		const handled = await dispatchSettingsMessage(ws, provider, broadcast, {
			type: "disableAgentOrchestrationAndStopSessions",
		});

		expect(handled).toBe(true);
		expect(stopSpy).toHaveBeenCalledWith(provider);
		expect(broadcast).toHaveBeenCalledWith("settingsChanged", payload);
	});
});
