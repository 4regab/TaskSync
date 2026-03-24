import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
	MAX_QUEUE_PROMPT_LENGTH,
	MAX_QUEUE_SIZE,
} from "../constants/remoteConstants";
import {
	handleAddQueuePrompt,
	handleClearPersistedHistory,
	handleRemoveHistoryItem,
	handleToggleQueue,
} from "../webview/queueHandlers";

// ─── Mock P factory ─────────────────────────────────────────

function createMockP(overrides: Partial<any> = {}) {
	return {
		_promptQueue: [] as any[],
		_queueEnabled: true,
		_queueVersion: 0,
		_currentToolCallId: null as string | null,
		_pendingRequests: new Map<string, (value: any) => void>(),
		_currentSessionCalls: [] as any[],
		_currentSessionCallsMap: new Map<string, any>(),
		_attachments: [] as any[],
		_responseTimeoutTimer: null as any,
		_view: {
			webview: {
				postMessage: vi.fn(),
			},
		},
		_remoteServer: null as any,
		_persistedHistory: [] as any[],
		_saveQueueToDisk: vi.fn(),
		_updateQueueUI: vi.fn(),
		_updateCurrentSessionUI: vi.fn(),
		_updateAttachmentsUI: vi.fn(),
		_updatePersistedHistoryUI: vi.fn(),
		_savePersistedHistoryToDisk: vi.fn(),
		...overrides,
	} as any;
}

// ─── handleAddQueuePrompt ───────────────────────────────────

describe("handleAddQueuePrompt", () => {
	it("adds prompt to queue when no pending tool call", () => {
		const p = createMockP();
		handleAddQueuePrompt(p, "Do this task", "q_1_abc", []);
		expect(p._promptQueue).toHaveLength(1);
		expect(p._promptQueue[0].prompt).toBe("Do this task");
		expect(p._promptQueue[0].id).toBe("q_1_abc");
	});

	it("trims whitespace from prompt", () => {
		const p = createMockP();
		handleAddQueuePrompt(p, "  trimmed  ", "q_1_abc", []);
		expect(p._promptQueue[0].prompt).toBe("trimmed");
	});

	it("generates ID when none provided", () => {
		const p = createMockP();
		handleAddQueuePrompt(p, "task", "", []);
		expect(p._promptQueue[0].id).toMatch(/^q_/);
	});

	it("rejects empty prompt", () => {
		const p = createMockP();
		handleAddQueuePrompt(p, "", "q_1_abc", []);
		expect(p._promptQueue).toHaveLength(0);
	});

	it("rejects whitespace-only prompt", () => {
		const p = createMockP();
		handleAddQueuePrompt(p, "   ", "q_1_abc", []);
		expect(p._promptQueue).toHaveLength(0);
	});

	it("rejects overly long prompt", () => {
		const p = createMockP();
		const longPrompt = "x".repeat(MAX_QUEUE_PROMPT_LENGTH + 1);
		handleAddQueuePrompt(p, longPrompt, "q_1_abc", []);
		expect(p._promptQueue).toHaveLength(0);
	});

	it("includes attachments when provided", () => {
		const p = createMockP();
		const attachments = [{ id: "a1", name: "file.ts", uri: "/file.ts" }];
		handleAddQueuePrompt(p, "task", "q_1_abc", attachments);
		expect(p._promptQueue[0].attachments).toEqual(attachments);
	});

	it("omits attachments field when empty", () => {
		const p = createMockP();
		handleAddQueuePrompt(p, "task", "q_1_abc", []);
		expect(p._promptQueue[0].attachments).toBeUndefined();
	});

	it("clears attachments after adding to queue", () => {
		const p = createMockP({ _attachments: [{ id: "a1" }] });
		handleAddQueuePrompt(p, "task", "q_1_abc", []);
		expect(p._attachments).toEqual([]);
		expect(p._updateAttachmentsUI).toHaveBeenCalled();
	});

	it("rejects when queue is full", () => {
		const queue = Array.from({ length: MAX_QUEUE_SIZE }, (_, i) => ({
			id: `q_${i}_abc`,
			prompt: `task ${i}`,
		}));
		const p = createMockP({ _promptQueue: queue });
		handleAddQueuePrompt(p, "overflow", "q_999_abc", []);
		expect(p._promptQueue).toHaveLength(MAX_QUEUE_SIZE);
	});

	// Auto-respond path
	it("auto-responds when queue is enabled and tool call is pending", () => {
		const resolve = vi.fn();
		const pendingRequests = new Map<string, any>();
		pendingRequests.set("tc_1", resolve);

		const pendingEntry = {
			id: "tc_1",
			prompt: "Question?",
			response: "",
			status: "pending",
			timestamp: 0,
			isFromQueue: false,
		};
		const sessionCallsMap = new Map<string, any>();
		sessionCallsMap.set("tc_1", pendingEntry);

		const p = createMockP({
			_queueEnabled: true,
			_currentToolCallId: "tc_1",
			_pendingRequests: pendingRequests,
			_currentSessionCalls: [pendingEntry],
			_currentSessionCallsMap: sessionCallsMap,
		});

		handleAddQueuePrompt(p, "Auto answer", "q_1_abc", []);

		// Should have resolved the pending request
		expect(resolve).toHaveBeenCalledWith(
			expect.objectContaining({ value: "Auto answer" }),
		);
		// Should NOT have added to queue
		expect(p._promptQueue).toHaveLength(0);
		// Should have cleared tool call
		expect(p._currentToolCallId).toBeNull();
		// Should have updated the pending entry
		expect(pendingEntry.status).toBe("completed");
		expect(pendingEntry.response).toBe("Auto answer");
		expect(pendingEntry.isFromQueue).toBe(true);
	});

	it("creates new entry when pending entry not found in session map", () => {
		const resolve = vi.fn();
		const pendingRequests = new Map<string, any>();
		pendingRequests.set("tc_1", resolve);

		const p = createMockP({
			_queueEnabled: true,
			_currentToolCallId: "tc_1",
			_pendingRequests: pendingRequests,
			_currentSessionCalls: [],
			_currentSessionCallsMap: new Map(),
		});

		handleAddQueuePrompt(p, "Answer", "q_1_abc", []);

		expect(resolve).toHaveBeenCalled();
		expect(p._currentSessionCalls).toHaveLength(1);
		expect(p._currentSessionCalls[0].status).toBe("completed");
	});

	it("clears response timeout timer on auto-respond", () => {
		const resolve = vi.fn();
		const pendingRequests = new Map<string, any>();
		pendingRequests.set("tc_1", resolve);
		const timer = setTimeout(() => { }, 10000);

		const p = createMockP({
			_queueEnabled: true,
			_currentToolCallId: "tc_1",
			_pendingRequests: pendingRequests,
			_currentSessionCalls: [],
			_currentSessionCallsMap: new Map(),
			_responseTimeoutTimer: timer,
		});

		handleAddQueuePrompt(p, "Answer", "q_1_abc", []);

		expect(p._responseTimeoutTimer).toBeNull();
		clearTimeout(timer);
	});

	it("does not auto-respond when queue is disabled", () => {
		const resolve = vi.fn();
		const pendingRequests = new Map<string, any>();
		pendingRequests.set("tc_1", resolve);

		const p = createMockP({
			_queueEnabled: false,
			_currentToolCallId: "tc_1",
			_pendingRequests: pendingRequests,
		});

		handleAddQueuePrompt(p, "Task", "q_1_abc", []);

		expect(resolve).not.toHaveBeenCalled();
		expect(p._promptQueue).toHaveLength(1);
	});

	it("does not auto-respond when no current tool call", () => {
		const p = createMockP({ _queueEnabled: true, _currentToolCallId: null });
		handleAddQueuePrompt(p, "Task", "q_1_abc", []);
		expect(p._promptQueue).toHaveLength(1);
	});

	it("handles case where resolve is missing from pendingRequests", () => {
		const pendingRequests = new Map<string, any>();
		pendingRequests.set("tc_1", undefined);

		const p = createMockP({
			_queueEnabled: true,
			_currentToolCallId: "tc_1",
			_pendingRequests: pendingRequests,
		});

		handleAddQueuePrompt(p, "Task", "q_1_abc", []);
		// Should fall through to queue since resolve was falsy (prompt not lost)
		expect(p._promptQueue).toHaveLength(1);
		expect(p._promptQueue[0].prompt).toBe("Task");
	});
});

// ─── handleToggleQueue ──────────────────────────────────────

describe("handleToggleQueue", () => {
	it("enables queue and saves", () => {
		const p = createMockP({ _queueEnabled: false });
		handleToggleQueue(p, true);
		expect(p._queueEnabled).toBe(true);
		expect(p._saveQueueToDisk).toHaveBeenCalled();
		expect(p._updateQueueUI).toHaveBeenCalled();
	});

	it("disables queue and saves", () => {
		const p = createMockP({ _queueEnabled: true });
		handleToggleQueue(p, false);
		expect(p._queueEnabled).toBe(false);
	});

	it("broadcasts to remote server when available", () => {
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn().mockReturnValue(undefined),
			inspect: vi.fn().mockReturnValue(undefined),
		} as any);
		const broadcast = vi.fn();
		const p = createMockP({ _remoteServer: { broadcast } });
		handleToggleQueue(p, true);
		expect(broadcast).toHaveBeenCalledWith(
			"settingsChanged",
			expect.objectContaining({ queueEnabled: true }),
		);
	});
});

// ─── handleRemoveHistoryItem ────────────────────────────────

describe("handleRemoveHistoryItem", () => {
	it("removes history item by call ID", () => {
		const p = createMockP({
			_persistedHistory: [
				{ id: "tc_1", prompt: "Q1", response: "A1" },
				{ id: "tc_2", prompt: "Q2", response: "A2" },
				{ id: "tc_3", prompt: "Q3", response: "A3" },
			],
		});
		handleRemoveHistoryItem(p, "tc_2");
		expect(p._persistedHistory).toHaveLength(2);
		expect(p._persistedHistory.map((h: any) => h.id)).toEqual(["tc_1", "tc_3"]);
		expect(p._updatePersistedHistoryUI).toHaveBeenCalled();
		expect(p._savePersistedHistoryToDisk).toHaveBeenCalled();
	});

	it("does nothing for non-existent ID", () => {
		const p = createMockP({
			_persistedHistory: [{ id: "tc_1", prompt: "Q", response: "A" }],
		});
		handleRemoveHistoryItem(p, "tc_999");
		expect(p._persistedHistory).toHaveLength(1);
	});
});

// ─── handleClearPersistedHistory ────────────────────────────

describe("handleClearPersistedHistory", () => {
	it("clears all persisted history", () => {
		const p = createMockP({
			_persistedHistory: [{ id: "tc_1" }, { id: "tc_2" }, { id: "tc_3" }],
		});
		handleClearPersistedHistory(p);
		expect(p._persistedHistory).toHaveLength(0);
		expect(p._updatePersistedHistoryUI).toHaveBeenCalled();
		expect(p._savePersistedHistoryToDisk).toHaveBeenCalled();
	});

	it("handles empty history gracefully", () => {
		const p = createMockP({ _persistedHistory: [] });
		handleClearPersistedHistory(p);
		expect(p._persistedHistory).toHaveLength(0);
	});
});
