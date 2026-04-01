import * as fs from "fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as vscode from "../__mocks__/vscode";
import {
	appendAutoAppendText,
	applyAutoAppendText,
	broadcastToolCallCompleted,
	formatElapsed,
	getFileIcon,
	getHumanLikeDelayMs,
	getNonce,
	hasQueuedItems,
	markSessionTerminated,
	notifyQueueChanged,
	parseFileLinkTarget,
	resolveFileLinkUri,
} from "../webview/webviewUtils";

vi.mock("fs", () => ({
	existsSync: vi.fn(() => false),
	statSync: vi.fn(() => ({ isFile: () => true })),
	promises: {
		stat: vi.fn(() => Promise.reject(new Error("ENOENT"))),
	},
}));

// ─── formatElapsed ───────────────────────────────────────────

describe("formatElapsed", () => {
	it("formats seconds only", () => {
		expect(formatElapsed(0)).toBe("0s");
		expect(formatElapsed(1000)).toBe("1s");
		expect(formatElapsed(59000)).toBe("59s");
	});

	it("formats minutes and seconds", () => {
		expect(formatElapsed(60000)).toBe("1m 0s");
		expect(formatElapsed(90000)).toBe("1m 30s");
		expect(formatElapsed(3599000)).toBe("59m 59s");
	});

	it("formats hours, minutes, and seconds", () => {
		expect(formatElapsed(3600000)).toBe("1h 0m 0s");
		expect(formatElapsed(3661000)).toBe("1h 1m 1s");
		expect(formatElapsed(7200000)).toBe("2h 0m 0s");
	});

	it("floors sub-second values", () => {
		expect(formatElapsed(500)).toBe("0s");
		expect(formatElapsed(1999)).toBe("1s");
	});
});

// ─── getHumanLikeDelayMs ─────────────────────────────────────

describe("getHumanLikeDelayMs", () => {
	it("returns 0 when disabled", () => {
		expect(getHumanLikeDelayMs(false, 1, 5)).toBe(0);
	});

	it("returns a value within range when enabled", () => {
		for (let i = 0; i < 20; i++) {
			const result = getHumanLikeDelayMs(true, 1, 3);
			expect(result).toBeGreaterThanOrEqual(1000);
			expect(result).toBeLessThanOrEqual(3000);
		}
	});

	it("works with equal min and max", () => {
		const result = getHumanLikeDelayMs(true, 2, 2);
		expect(result).toBe(2000);
	});
});

// ─── getFileIcon ─────────────────────────────────────────────

describe("getFileIcon", () => {
	it("maps code file extensions", () => {
		expect(getFileIcon("app.ts")).toBe("file-code");
		expect(getFileIcon("index.tsx")).toBe("file-code");
		expect(getFileIcon("main.js")).toBe("file-code");
		expect(getFileIcon("component.jsx")).toBe("file-code");
		expect(getFileIcon("script.py")).toBe("file-code");
		expect(getFileIcon("App.java")).toBe("file-code");
		expect(getFileIcon("page.html")).toBe("file-code");
		expect(getFileIcon("style.css")).toBe("file-code");
	});

	it("maps data file extensions", () => {
		expect(getFileIcon("config.json")).toBe("json");
		expect(getFileIcon("README.md")).toBe("markdown");
		expect(getFileIcon("notes.txt")).toBe("file-text");
	});

	it("maps media file extensions", () => {
		expect(getFileIcon("photo.png")).toBe("file-media");
		expect(getFileIcon("image.jpg")).toBe("file-media");
		expect(getFileIcon("icon.svg")).toBe("file-media");
	});

	it("maps terminal file extensions", () => {
		expect(getFileIcon("setup.sh")).toBe("terminal");
		expect(getFileIcon("run.bash")).toBe("terminal");
	});

	it("maps archive file extensions", () => {
		expect(getFileIcon("bundle.zip")).toBe("file-zip");
		expect(getFileIcon("archive.tar")).toBe("file-zip");
		expect(getFileIcon("compressed.gz")).toBe("file-zip");
	});

	it("returns 'file' for unknown extensions", () => {
		expect(getFileIcon("data.xyz")).toBe("file");
		expect(getFileIcon("noext")).toBe("file");
	});
});

// ─── parseFileLinkTarget ─────────────────────────────────────

describe("parseFileLinkTarget", () => {
	it("parses path without line numbers", () => {
		const result = parseFileLinkTarget("src/app.ts");
		expect(result).toEqual({
			filePath: "src/app.ts",
			startLine: null,
			endLine: null,
		});
	});

	it("parses path with single line number", () => {
		const result = parseFileLinkTarget("src/app.ts#L42");
		expect(result).toEqual({
			filePath: "src/app.ts",
			startLine: 42,
			endLine: null,
		});
	});

	it("parses path with line range", () => {
		const result = parseFileLinkTarget("src/app.ts#L10-L20");
		expect(result).toEqual({
			filePath: "src/app.ts",
			startLine: 10,
			endLine: 20,
		});
	});

	it("trims whitespace from path", () => {
		const result = parseFileLinkTarget("  src/app.ts  ");
		expect(result.filePath).toBe("src/app.ts");
	});

	it("handles empty string", () => {
		const result = parseFileLinkTarget("");
		expect(result.filePath).toBe("");
		expect(result.startLine).toBeNull();
	});

	it("handles path with no match gracefully", () => {
		const result = parseFileLinkTarget("some/path");
		expect(result.filePath).toBe("some/path");
		expect(result.startLine).toBeNull();
		expect(result.endLine).toBeNull();
	});
});

// ─── hasQueuedItems ──────────────────────────────────────────

describe("hasQueuedItems", () => {
	it("returns true when queue is enabled and has items", () => {
		const p = {
			_queueEnabled: true,
			_promptQueue: [{ id: "1", prompt: "test" }],
		} as any;
		expect(hasQueuedItems(p)).toBe(true);
	});

	it("returns false when queue is disabled", () => {
		const p = {
			_queueEnabled: false,
			_promptQueue: [{ id: "1", prompt: "test" }],
		} as any;
		expect(hasQueuedItems(p)).toBe(false);
	});

	it("returns false when queue is empty", () => {
		const p = { _queueEnabled: true, _promptQueue: [] } as any;
		expect(hasQueuedItems(p)).toBe(false);
	});

	it("returns false when both disabled and empty", () => {
		const p = { _queueEnabled: false, _promptQueue: [] } as any;
		expect(hasQueuedItems(p)).toBe(false);
	});
});

// ─── auto append helpers ────────────────────────────────────

describe("appendAutoAppendText", () => {
	it("returns original response when append text is empty", () => {
		expect(appendAutoAppendText("Answer", "   ")).toBe("Answer");
	});

	it("returns append text when response is empty", () => {
		expect(appendAutoAppendText("", "Rule")).toBe("Rule");
	});

	it("appends with a blank line separator", () => {
		expect(appendAutoAppendText("Answer", "Rule")).toBe("Answer\n\nRule");
	});
});

describe("applyAutoAppendText", () => {
	it("does not append when disabled", () => {
		expect(applyAutoAppendText(false, "Answer", "Rule")).toBe("Answer");
	});

	it("appends when enabled", () => {
		expect(applyAutoAppendText(true, "Answer", "Rule")).toBe("Answer\n\nRule");
	});
});

// ─── getNonce ────────────────────────────────────────────────

describe("getNonce", () => {
	it("returns a 32-char hex string", () => {
		const nonce = getNonce();
		expect(nonce).toMatch(/^[0-9a-f]{32}$/);
	});

	it("returns unique values on each call", () => {
		const a = getNonce();
		const b = getNonce();
		expect(a).not.toBe(b);
	});
});

// ─── notifyQueueChanged ─────────────────────────────────────

describe("notifyQueueChanged", () => {
	it("increments version, saves, updates UI, and broadcasts", () => {
		const broadcast = vi.fn();
		const p = {
			_queueVersion: 5,
			_promptQueue: [
				{
					id: "q1",
					prompt: "test prompt",
					attachments: [{ id: "a1", name: "f.txt", uri: "file:///f.txt" }],
				},
			],
			_saveQueueToDisk: vi.fn(),
			_updateQueueUI: vi.fn(),
			_remoteServer: { broadcast },
		} as any;

		notifyQueueChanged(p);

		expect(p._queueVersion).toBe(6);
		expect(p._saveQueueToDisk).toHaveBeenCalled();
		expect(p._updateQueueUI).toHaveBeenCalled();
		expect(broadcast).toHaveBeenCalledWith("queueChanged", {
			queue: [
				{
					id: "q1",
					prompt: "test prompt",
					attachments: [{ id: "a1", name: "f.txt", uri: "file:///f.txt" }],
				},
			],
			queueVersion: 6,
		});
	});

	it("handles missing remoteServer gracefully", () => {
		const p = {
			_queueVersion: 0,
			_promptQueue: [],
			_saveQueueToDisk: vi.fn(),
			_updateQueueUI: vi.fn(),
			_remoteServer: null,
		} as any;

		expect(() => notifyQueueChanged(p)).not.toThrow();
		expect(p._queueVersion).toBe(1);
	});

	it("adds empty attachments array for items without attachments", () => {
		const broadcast = vi.fn();
		const p = {
			_queueVersion: 0,
			_promptQueue: [{ id: "q1", prompt: "test" }],
			_saveQueueToDisk: vi.fn(),
			_updateQueueUI: vi.fn(),
			_remoteServer: { broadcast },
		} as any;

		notifyQueueChanged(p);

		const broadcastedQueue = broadcast.mock.calls[0][1].queue;
		expect(broadcastedQueue[0].attachments).toEqual([]);
	});
});

// ─── broadcastToolCallCompleted ──────────────────────────────

describe("broadcastToolCallCompleted", () => {
	it("broadcasts tool call entry to remote clients", () => {
		const broadcast = vi.fn();
		const p = { _remoteServer: { broadcast } } as any;
		const entry = {
			id: "tc1",
			prompt: "Do something",
			response: "Done",
			timestamp: 1234567890,
			status: "completed" as const,
			attachments: [],
			isFromQueue: false,
		};

		broadcastToolCallCompleted(p, entry);

		expect(broadcast).toHaveBeenCalledWith("toolCallCompleted", {
			id: "tc1",
			entry: {
				id: "tc1",
				prompt: "Do something",
				response: "Done",
				timestamp: 1234567890,
				status: "completed",
				attachments: [],
				isFromQueue: false,
			},
			sessionTerminated: false,
		});
	});

	it("passes sessionTerminated flag when provided", () => {
		const broadcast = vi.fn();
		const p = { _remoteServer: { broadcast } } as any;
		const entry = {
			id: "tc2",
			prompt: "p",
			response: "r",
			timestamp: 0,
			status: "completed" as const,
			attachments: [],
			isFromQueue: true,
		};

		broadcastToolCallCompleted(p, entry, true);

		expect(broadcast.mock.calls[0][1].sessionTerminated).toBe(true);
	});

	it("handles missing remoteServer gracefully", () => {
		const p = { _remoteServer: null } as any;
		const entry = {
			id: "tc3",
			prompt: "p",
			response: "r",
			timestamp: 0,
			status: "pending" as const,
			attachments: [],
			isFromQueue: false,
		};

		expect(() => broadcastToolCallCompleted(p, entry)).not.toThrow();
	});
});

// ─── markSessionTerminated ───────────────────────────────────

describe("markSessionTerminated", () => {
	it("sets terminated flag and freezes elapsed time", () => {
		const now = Date.now();
		const p = {
			_sessionManager: { getActiveSessionId: () => "1" },
			_sessionFrozenElapsed: 0,
			_stopSessionTimerInterval: vi.fn(),
			_updateViewTitle: vi.fn(),
		} as any;
		const session = {
			id: "1",
			sessionStartTime: now - 5000,
			sessionFrozenElapsed: 0,
			sessionTerminated: false,
			aiTurnActive: true,
			waitingOnUser: true,
			pendingToolCallId: "tc_1",
		} as any;

		markSessionTerminated(p, session);

		expect(session.sessionTerminated).toBe(true);
		expect(session.unread).toBe(false);
		expect(session.sessionFrozenElapsed).toBeGreaterThanOrEqual(4900);
		expect(session.sessionFrozenElapsed).toBeLessThanOrEqual(6000);
		expect(p._sessionFrozenElapsed).toBeGreaterThanOrEqual(4900);
		expect(p._stopSessionTimerInterval).toHaveBeenCalled();
		expect(p._updateViewTitle).toHaveBeenCalled();
	});

	it("handles null sessionStartTime (no active session)", () => {
		const p = {
			_sessionManager: { getActiveSessionId: () => null },
			_sessionFrozenElapsed: 0,
			_stopSessionTimerInterval: vi.fn(),
			_updateViewTitle: vi.fn(),
		} as any;
		const session = {
			id: "2",
			sessionStartTime: null,
			sessionFrozenElapsed: 0,
			sessionTerminated: false,
			aiTurnActive: true,
			waitingOnUser: true,
			unread: true,
			pendingToolCallId: "tc_2",
		} as any;

		markSessionTerminated(p, session);

		expect(session.sessionTerminated).toBe(true);
		expect(session.unread).toBe(false);
		expect(session.sessionFrozenElapsed).toBe(0);
		expect(p._stopSessionTimerInterval).not.toHaveBeenCalled();
		expect(p._updateViewTitle).not.toHaveBeenCalled();
	});
});

// ─── resolveFileLinkUri ──────────────────────────────────────

describe("resolveFileLinkUri", () => {
	afterEach(() => {
		(fs.promises.stat as any).mockRejectedValue(new Error("ENOENT"));
	});

	it("returns null for empty string", async () => {
		expect(await resolveFileLinkUri("")).toBeNull();
	});

	it("returns null for whitespace-only string", async () => {
		expect(await resolveFileLinkUri("   ")).toBeNull();
	});

	it("returns null when file does not exist (absolute path)", async () => {
		(fs.promises.stat as any).mockRejectedValue(new Error("ENOENT"));
		expect(await resolveFileLinkUri("/nonexistent/file.ts")).toBeNull();
	});

	it("returns Uri for existing absolute path", async () => {
		// Make Uri.parse throw so it falls through to isAbsolute check
		const origParse = vscode.Uri.parse;
		(vscode.Uri as any).parse = () => {
			throw new Error("not a URI");
		};
		(fs.promises.stat as any).mockResolvedValue({
			isFile: () => true,
		} as any);
		const result = await resolveFileLinkUri("/existing/file.ts");
		expect(result).not.toBeNull();
		(vscode.Uri as any).parse = origParse;
	});

	it("returns null for absolute path that is a directory", async () => {
		const origParse = vscode.Uri.parse;
		(vscode.Uri as any).parse = () => {
			throw new Error("not a URI");
		};
		(fs.promises.stat as any).mockResolvedValue({
			isFile: () => false,
		} as any);
		expect(await resolveFileLinkUri("/some/directory")).toBeNull();
		(vscode.Uri as any).parse = origParse;
	});

	it("strips leading ./ from relative paths", async () => {
		(fs.promises.stat as any).mockRejectedValue(new Error("ENOENT"));
		// Should normalize path and not crash
		expect(await resolveFileLinkUri("./src/file.ts")).toBeNull();
	});

	it("returns null for relative path with no workspace folders", async () => {
		(fs.promises.stat as any).mockRejectedValue(new Error("ENOENT"));
		expect(await resolveFileLinkUri("src/file.ts")).toBeNull();
	});

	it("resolves relative path against workspace folders", async () => {
		const origParse = vscode.Uri.parse;
		(vscode.Uri as any).parse = () => {
			throw new Error("not a URI");
		};
		const original = vscode.workspace.workspaceFolders;
		(vscode.workspace as any).workspaceFolders = [
			{ uri: { fsPath: "/workspace" } },
		];
		(fs.promises.stat as any).mockResolvedValue({
			isFile: () => true,
		} as any);

		const result = await resolveFileLinkUri("src/file.ts");
		expect(result).not.toBeNull();

		(vscode.workspace as any).workspaceFolders = original;
		(vscode.Uri as any).parse = origParse;
	});

	it("returns null when relative file not found in any workspace folder", async () => {
		const origParse = vscode.Uri.parse;
		(vscode.Uri as any).parse = () => {
			throw new Error("not a URI");
		};
		const original = vscode.workspace.workspaceFolders;
		(vscode.workspace as any).workspaceFolders = [
			{ uri: { fsPath: "/workspace" } },
		];
		(fs.promises.stat as any).mockRejectedValue(new Error("ENOENT"));

		expect(await resolveFileLinkUri("nonexistent/file.ts")).toBeNull();

		(vscode.workspace as any).workspaceFolders = original;
		(vscode.Uri as any).parse = origParse;
	});

	it("resolves file:// URI scheme", async () => {
		(fs.promises.stat as any).mockResolvedValue({
			isFile: () => true,
		} as any);

		const result = await resolveFileLinkUri("file:///some/file.ts");
		expect(result).not.toBeNull();
	});
});
