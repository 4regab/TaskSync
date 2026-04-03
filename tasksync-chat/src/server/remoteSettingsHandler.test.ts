import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import "../__mocks__/vscode";
import * as settingsH from "../webview/settingsHandlers";
import { dispatchSettingsMessage } from "./remoteSettingsHandler";

describe("dispatchSettingsMessage", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("handles updateAgentOrchestrationSetting without a duplicate dispatcher broadcast", async () => {
		const ws = { send: vi.fn() } as unknown as WebSocket;
		const provider = {} as any;
		const broadcast = vi.fn();

		const updateSpy = vi
			.spyOn(settingsH, "handleUpdateAgentOrchestrationSetting")
			.mockResolvedValue(undefined);

		const handled = await dispatchSettingsMessage(ws, provider, broadcast, {
			type: "updateAgentOrchestrationSetting",
			enabled: false,
		});

		expect(handled).toBe(true);
		expect(updateSpy).toHaveBeenCalledWith(provider, false);
		expect(broadcast).not.toHaveBeenCalled();
	});

	it("handles disableAgentOrchestrationAndStopSessions without a duplicate dispatcher broadcast", async () => {
		const ws = { send: vi.fn() } as unknown as WebSocket;
		const provider = {} as any;
		const broadcast = vi.fn();

		const stopSpy = vi
			.spyOn(settingsH, "handleStopSessionsAndDisableAgentOrchestration")
			.mockResolvedValue(undefined);

		const handled = await dispatchSettingsMessage(ws, provider, broadcast, {
			type: "disableAgentOrchestrationAndStopSessions",
		});

		expect(handled).toBe(true);
		expect(stopSpy).toHaveBeenCalledWith(provider);
		expect(broadcast).not.toHaveBeenCalled();
	});
});
