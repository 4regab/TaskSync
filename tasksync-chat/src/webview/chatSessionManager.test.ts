import { describe, expect, test } from "vitest";
import { ChatSessionManager } from "./chatSessionManager";

describe("ChatSessionManager", () => {
	test("creates a new session and sets it as active", () => {
		const manager = new ChatSessionManager();
		const session = manager.createSession("Test Session");
		expect(session.id).toBeDefined();
		expect(session.id).toBe("1");
		expect(session.title).toBe("Test Session");
		expect(session.status).toBe("active");
		expect(session.queue).toEqual([]);
		expect(session.history).toEqual([]);
		expect(session.autopilotEnabled).toBe(false);
		expect(session.waitingOnUser).toBe(false);
		expect(session.createdAt).toBeGreaterThan(0);
		expect(manager.getActiveSession()?.id).toBe(session.id);
		expect(manager.getAllSessions().length).toBe(1);
	});

	test("creates multiple sessions and switches active", () => {
		const manager = new ChatSessionManager();
		const s1 = manager.createSession("Session 1");
		const s2 = manager.createSession("Session 2");
		expect(s1.id).toBe("1");
		expect(s2.id).toBe("2");
		// Latest session is active
		expect(manager.getActiveSession()?.id).toBe(s2.id);
		expect(manager.getAllSessions().length).toBe(2);

		// Switch back to first
		const result = manager.setActiveSession(s1.id);
		expect(result).toBe(true);
		expect(manager.getActiveSession()?.id).toBe(s1.id);
	});

	test("getSession retrieves by ID", () => {
		const manager = new ChatSessionManager();
		const session = manager.createSession("Lookup Test");
		expect(manager.getSession(session.id)?.title).toBe("Lookup Test");
		expect(manager.getSession("nonexistent")).toBeUndefined();
	});

	test("setActiveSession returns false for nonexistent ID", () => {
		const manager = new ChatSessionManager();
		expect(manager.setActiveSession("nonexistent")).toBe(false);
	});

	test("archiveSession marks session as archived", () => {
		const manager = new ChatSessionManager();
		const s1 = manager.createSession("To Archive");
		const s2 = manager.createSession("Keep Active");

		expect(manager.archiveSession(s1.id)).toBe(true);
		expect(manager.getSession(s1.id)?.status).toBe("archived");
		// Active should stay as s2
		expect(manager.getActiveSession()?.id).toBe(s2.id);
	});

	test("archiveSession switches active if archived session was active", () => {
		const manager = new ChatSessionManager();
		const s1 = manager.createSession("First");
		manager.createSession("Second");
		// s2 is active; archive it
		manager.archiveSession(manager.getActiveSessionId()!);
		// Should fall back to s1
		expect(manager.getActiveSession()?.id).toBe(s1.id);
	});

	test("deleteSession removes session entirely", () => {
		const manager = new ChatSessionManager();
		const session = manager.createSession("Delete Me");
		expect(manager.deleteSession(session.id)).toBe(true);
		expect(manager.size).toBe(0);
		expect(manager.getActiveSession()).toBeUndefined();
	});

	test("deleteSession returns false for nonexistent ID", () => {
		const manager = new ChatSessionManager();
		expect(manager.deleteSession("nonexistent")).toBe(false);
	});

	test("getActiveSessions filters out archived", () => {
		const manager = new ChatSessionManager();
		manager.createSession("Active");
		const s2 = manager.createSession("Will Archive");
		manager.archiveSession(s2.id);
		expect(manager.getActiveSessions().length).toBe(1);
		expect(manager.getAllSessions().length).toBe(2);
	});

	test("getWaitingSessions returns sessions waiting on user", () => {
		const manager = new ChatSessionManager();
		const s1 = manager.createSession("Not Waiting");
		const s2 = manager.createSession("Waiting");
		s2.waitingOnUser = true;
		const waiting = manager.getWaitingSessions();
		expect(waiting.length).toBe(1);
		expect(waiting[0].id).toBe(s2.id);
	});

	test("addHistoryEntry adds to correct session", () => {
		const manager = new ChatSessionManager();
		const session = manager.createSession("History Test");
		const entry = {
			id: "tc_123",
			prompt: "test prompt",
			response: "test response",
			timestamp: Date.now(),
			isFromQueue: false,
			status: "completed" as const,
		};
		expect(manager.addHistoryEntry(session.id, entry)).toBe(true);
		expect(session.history.length).toBe(1);
		expect(session.history[0].id).toBe("tc_123");
	});

	test("addHistoryEntry returns false for nonexistent session", () => {
		const manager = new ChatSessionManager();
		const entry = {
			id: "tc_123",
			prompt: "test",
			response: "test",
			timestamp: Date.now(),
			isFromQueue: false,
			status: "completed" as const,
		};
		expect(manager.addHistoryEntry("nonexistent", entry)).toBe(false);
	});

	test("addQueueItem and dequeueItem work correctly", () => {
		const manager = new ChatSessionManager();
		const session = manager.createSession("Queue Test");
		const item = { id: "q_123", prompt: "do something" };
		expect(manager.addQueueItem(session.id, item)).toBe(true);
		expect(session.queue.length).toBe(1);

		const dequeued = manager.dequeueItem(session.id);
		expect(dequeued?.id).toBe("q_123");
		expect(session.queue.length).toBe(0);
	});

	test("dequeueItem returns undefined for empty queue", () => {
		const manager = new ChatSessionManager();
		const session = manager.createSession("Empty Queue");
		expect(manager.dequeueItem(session.id)).toBeUndefined();
	});

	test("toJSON and fromJSON round-trip correctly", () => {
		const manager = new ChatSessionManager();
		const s1 = manager.createSession("Session A");
		const s2 = manager.createSession("Session B");
		s1.waitingOnUser = true;
		s2.autopilotEnabled = true;

		const json = manager.toJSON();
		expect(json.sessions.length).toBe(2);
		expect(json.activeSessionId).toBe(s2.id);

		// Restore into a new manager
		const manager2 = new ChatSessionManager();
		manager2.fromJSON(json);
		expect(manager2.getAllSessions().length).toBe(2);
		expect(manager2.getActiveSession()?.id).toBe(s2.id);
		expect(manager2.getSession(s1.id)?.waitingOnUser).toBe(true);
		expect(manager2.getSession(s2.id)?.autopilotEnabled).toBe(true);
	});

	test("fromJSON leaves per-session fields undefined for legacy sessions", () => {
		const manager = new ChatSessionManager();
		// Simulate old session data that never had per-session fields
		manager.fromJSON({
			activeSessionId: "1",
			sessions: [
				{
					id: "1",
					title: "Agent 1",
					status: "active",
					queue: [],
					queueEnabled: true,
					history: [],
					attachments: [],
					autopilotEnabled: false,
					waitingOnUser: false,
					createdAt: Date.now(),
					pendingToolCallId: null,
					sessionStartTime: null,
					sessionFrozenElapsed: null,
					sessionTerminated: false,
					sessionWarningShown: false,
					aiTurnActive: false,
					consecutiveAutoResponses: 0,
					autopilotIndex: 0,
				},
			],
		});
		const session = manager.getSession("1");
		// Fields not present in raw data should remain undefined (inherit from config)
		expect(session?.autopilotText).toBeUndefined();
		expect(session?.autopilotPrompts).toBeUndefined();
		expect(session?.autoAppendEnabled).toBeUndefined();
		expect(session?.autoAppendText).toBeUndefined();
	});

	test("fromJSON handles invalid activeSessionId gracefully", () => {
		const manager = new ChatSessionManager();
		const session = manager.createSession("Only One");
		const json = manager.toJSON();
		json.activeSessionId = "deleted_session";

		const manager2 = new ChatSessionManager();
		manager2.fromJSON(json);
		// Should fallback to the first active session
		expect(manager2.getActiveSession()?.id).toBe(session.id);
	});

	test("size property reflects current count", () => {
		const manager = new ChatSessionManager();
		expect(manager.size).toBe(0);
		manager.createSession("A");
		expect(manager.size).toBe(1);
		manager.createSession("B");
		expect(manager.size).toBe(2);
	});

	test("default title uses Agent numbering", () => {
		const manager = new ChatSessionManager();
		const session = manager.createSession();
		expect(session.title).toBe("Agent 1");
	});

	test("ensureSession renames legacy auto-generated titles to Agent numbering", () => {
		const manager = new ChatSessionManager();
		manager.fromJSON({
			activeSessionId: "1",
			sessions: [
				{
					id: "1",
					title: "Conversation ses_123",
					status: "active",
					queue: [],
					queueEnabled: true,
					history: [],
					attachments: [],
					autopilotEnabled: false,
					autopilotText: "",
					autopilotPrompts: [],
					autoAppendEnabled: false,
					autoAppendText: "",
					waitingOnUser: false,
					createdAt: Date.now(),
					pendingToolCallId: null,
					sessionStartTime: null,
					sessionFrozenElapsed: null,
					sessionTerminated: false,
					sessionWarningShown: false,
					aiTurnActive: false,
					consecutiveAutoResponses: 0,
					autopilotIndex: 0,
				},
			],
		});

		expect(manager.getSession("1")?.title).toBe("Agent 1");
	});

	test("renameSession updates session title", () => {
		const manager = new ChatSessionManager();
		manager.createSession("Agent 1");
		expect(manager.renameSession("1", "My Custom Name")).toBe(true);
		expect(manager.getSession("1")?.title).toBe("My Custom Name");
	});

	test("renameSession returns false for non-existent session", () => {
		const manager = new ChatSessionManager();
		expect(manager.renameSession("nonexistent", "Title")).toBe(false);
	});

	test("renameSession rejects empty or whitespace-only title", () => {
		const manager = new ChatSessionManager();
		manager.createSession("Agent 1");
		expect(manager.renameSession("1", "")).toBe(false);
		expect(manager.renameSession("1", "   ")).toBe(false);
		expect(manager.getSession("1")?.title).toBe("Agent 1");
	});

	test("renameSession trims whitespace from title", () => {
		const manager = new ChatSessionManager();
		manager.createSession("Agent 1");
		expect(manager.renameSession("1", "  New Title  ")).toBe(true);
		expect(manager.getSession("1")?.title).toBe("New Title");
	});

	test("getNextSessionId skips deleted session IDs", () => {
		const manager = new ChatSessionManager();
		manager.createSession("Agent 1"); // id "1"
		manager.createSession("Agent 2"); // id "2"
		manager.createSession("Agent 3"); // id "3"
		manager.deleteSession("3");
		// With the fix, getNextSessionId must skip "3" (tombstoned) → return "4"
		expect(manager.getNextSessionId()).toBe("4");
	});

	test("getNextSessionId skips multiple deleted IDs", () => {
		const manager = new ChatSessionManager();
		manager.createSession("A"); // "1"
		manager.createSession("B"); // "2"
		manager.createSession("C"); // "3"
		manager.createSession("D"); // "4"
		manager.deleteSession("3");
		manager.deleteSession("4");
		// Max of live {1,2} and deleted {3,4} is 4 → next is "5"
		expect(manager.getNextSessionId()).toBe("5");
	});

	test("ensureSession with deleted ID creates session with fresh ID", () => {
		const manager = new ChatSessionManager();
		manager.createSession("Agent 1"); // "1"
		manager.createSession("Agent 2"); // "2"
		manager.deleteSession("2");
		// Trying to ensure deleted "2" should not resurrect it
		const session = manager.ensureSession("2", "Ghost");
		expect(session.id).not.toBe("2");
		expect(session.id).toBe("3");
	});
});
