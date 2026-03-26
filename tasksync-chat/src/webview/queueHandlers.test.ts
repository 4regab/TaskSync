import { describe, expect, it, vi } from "vitest";
import "../__mocks__/vscode";
import { MAX_QUEUE_PROMPT_LENGTH } from "../constants/remoteConstants";
import {
	handleClearQueue,
	handleEditQueuePrompt,
	handleRemoveQueuePrompt,
	handleReorderQueue,
} from "../webview/queueHandlers";

// Valid queue IDs must match /^q_\d+_[a-z0-9]+$/
const ID1 = "q_100_abc";
const ID2 = "q_200_def";
const ID3 = "q_300_ghi";

function createMockP(queue: Array<{ id: string; prompt: string }> = []) {
	return {
		_promptQueue: queue.map((q) => ({ ...q })),
		_queueEnabled: true,
		_queueVersion: 0,
		_saveQueueToDisk: vi.fn(),
		_updateQueueUI: vi.fn(),
		_remoteServer: null,
	} as any;
}

// ─── handleRemoveQueuePrompt ─────────────────────────────────

describe("handleRemoveQueuePrompt", () => {
	it("removes the matching prompt from queue", () => {
		const p = createMockP([
			{ id: ID1, prompt: "First" },
			{ id: ID2, prompt: "Second" },
			{ id: ID3, prompt: "Third" },
		]);
		handleRemoveQueuePrompt(p, ID2);
		expect(p._promptQueue).toHaveLength(2);
		expect(p._promptQueue.map((q: any) => q.id)).toEqual([ID1, ID3]);
	});

	it("calls notifyQueueChanged exactly once per removal", () => {
		const p = createMockP([
			{ id: ID1, prompt: "First" },
			{ id: ID2, prompt: "Second" },
		]);
		handleRemoveQueuePrompt(p, ID1);
		expect(p._saveQueueToDisk).toHaveBeenCalledTimes(1);
		expect(p._updateQueueUI).toHaveBeenCalledTimes(1);
	});

	it("does nothing for non-existent ID", () => {
		const p = createMockP([{ id: ID1, prompt: "First" }]);
		handleRemoveQueuePrompt(p, "q_999_zzz");
		expect(p._promptQueue).toHaveLength(1);
	});

	it("rejects invalid queue IDs", () => {
		const p = createMockP([{ id: ID1, prompt: "First" }]);
		handleRemoveQueuePrompt(p, "");
		expect(p._promptQueue).toHaveLength(1);
		expect(p._saveQueueToDisk).not.toHaveBeenCalled();
	});
});

// ─── handleEditQueuePrompt ───────────────────────────────────

describe("handleEditQueuePrompt", () => {
	it("updates the prompt text for matching ID", () => {
		const p = createMockP([{ id: ID1, prompt: "Old text" }]);
		handleEditQueuePrompt(p, ID1, "New text");
		expect(p._promptQueue[0].prompt).toBe("New text");
	});

	it("trims whitespace from new prompt", () => {
		const p = createMockP([{ id: ID1, prompt: "Old" }]);
		handleEditQueuePrompt(p, ID1, "  Trimmed  ");
		expect(p._promptQueue[0].prompt).toBe("Trimmed");
	});

	it("rejects empty/whitespace-only new prompt", () => {
		const p = createMockP([{ id: ID1, prompt: "Keep this" }]);
		handleEditQueuePrompt(p, ID1, "   ");
		expect(p._promptQueue[0].prompt).toBe("Keep this");
		expect(p._saveQueueToDisk).not.toHaveBeenCalled();
	});

	it("rejects excessively long prompts", () => {
		const p = createMockP([{ id: ID1, prompt: "Keep" }]);
		const longPrompt = "x".repeat(MAX_QUEUE_PROMPT_LENGTH + 1);
		handleEditQueuePrompt(p, ID1, longPrompt);
		expect(p._promptQueue[0].prompt).toBe("Keep");
		expect(p._saveQueueToDisk).not.toHaveBeenCalled();
	});

	it("does nothing for non-existent ID", () => {
		const p = createMockP([{ id: ID1, prompt: "Keep" }]);
		handleEditQueuePrompt(p, "q_999_zzz", "New text");
		expect(p._promptQueue[0].prompt).toBe("Keep");
	});

	it("rejects invalid queue IDs", () => {
		const p = createMockP([{ id: ID1, prompt: "Keep" }]);
		handleEditQueuePrompt(p, "", "New text");
		expect(p._promptQueue[0].prompt).toBe("Keep");
		expect(p._saveQueueToDisk).not.toHaveBeenCalled();
	});
});

// ─── handleReorderQueue ──────────────────────────────────────

describe("handleReorderQueue", () => {
	it("moves item forward in queue", () => {
		const p = createMockP([
			{ id: ID1, prompt: "A" },
			{ id: ID2, prompt: "B" },
			{ id: ID3, prompt: "C" },
		]);
		handleReorderQueue(p, 0, 2);
		expect(p._promptQueue.map((q: any) => q.id)).toEqual([ID2, ID3, ID1]);
	});

	it("moves item backward in queue", () => {
		const p = createMockP([
			{ id: ID1, prompt: "A" },
			{ id: ID2, prompt: "B" },
			{ id: ID3, prompt: "C" },
		]);
		handleReorderQueue(p, 2, 0);
		expect(p._promptQueue.map((q: any) => q.id)).toEqual([ID3, ID1, ID2]);
	});

	it("no-op when from and to are the same", () => {
		const p = createMockP([
			{ id: ID1, prompt: "A" },
			{ id: ID2, prompt: "B" },
		]);
		handleReorderQueue(p, 0, 0);
		expect(p._promptQueue.map((q: any) => q.id)).toEqual([ID1, ID2]);
	});

	it("rejects negative indices", () => {
		const p = createMockP([{ id: ID1, prompt: "A" }]);
		handleReorderQueue(p, -1, 0);
		expect(p._saveQueueToDisk).not.toHaveBeenCalled();
	});

	it("rejects out-of-bounds indices", () => {
		const p = createMockP([{ id: ID1, prompt: "A" }]);
		handleReorderQueue(p, 0, 5);
		expect(p._saveQueueToDisk).not.toHaveBeenCalled();
	});

	it("rejects non-integer indices", () => {
		const p = createMockP([
			{ id: ID1, prompt: "A" },
			{ id: ID2, prompt: "B" },
		]);
		handleReorderQueue(p, 0.5, 1);
		expect(p._saveQueueToDisk).not.toHaveBeenCalled();
	});
});

// ─── handleClearQueue ────────────────────────────────────────

describe("handleClearQueue", () => {
	it("empties the queue", () => {
		const p = createMockP([
			{ id: ID1, prompt: "A" },
			{ id: ID2, prompt: "B" },
		]);
		handleClearQueue(p);
		expect(p._promptQueue).toHaveLength(0);
		expect(p._saveQueueToDisk).toHaveBeenCalled();
	});

	it("no-op on empty queue", () => {
		const p = createMockP([]);
		handleClearQueue(p);
		expect(p._promptQueue).toHaveLength(0);
	});
});
