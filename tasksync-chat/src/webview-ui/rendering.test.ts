import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import vm from "vm";

class FakeClassList {
	private readonly classes = new Set<string>();

	constructor(initial: string[] = []) {
		for (const name of initial) {
			this.classes.add(name);
		}
	}

	add(...names: string[]) {
		for (const name of names) {
			this.classes.add(name);
		}
	}

	remove(...names: string[]) {
		for (const name of names) {
			this.classes.delete(name);
		}
	}

	toggle(name: string, force?: boolean) {
		if (force === true) {
			this.classes.add(name);
			return true;
		}
		if (force === false) {
			this.classes.delete(name);
			return false;
		}
		if (this.classes.has(name)) {
			this.classes.delete(name);
			return false;
		}
		this.classes.add(name);
		return true;
	}

	contains(name: string) {
		return this.classes.has(name);
	}
}

class FakeElement {
	readonly classList: FakeClassList;
	readonly style: Record<string, string> = {};
	readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
	readonly attributes = new Map<string, string>();
	readonly selectorResults = new Map<string, FakeElement[]>();
	innerHTML = "";
	textContent = "";
	title = "";

	constructor(
		readonly id = "",
		classes: string[] = [],
	) {
		this.classList = new FakeClassList(classes);
	}

	addEventListener(eventName: string, handler: (...args: unknown[]) => void) {
		const handlers = this.listeners.get(eventName) || [];
		handlers.push(handler);
		this.listeners.set(eventName, handlers);
	}

	querySelectorAll(selector: string) {
		return this.selectorResults.get(selector) || [];
	}

	setAttribute(name: string, value: string) {
		if (name === "title") {
			this.title = value;
			return;
		}
		this.attributes.set(name, value);
	}

	getAttribute(name: string) {
		if (name === "title") {
			return this.title;
		}
		return this.attributes.get(name) || null;
	}
}

type SessionSummary = Record<string, unknown>;

type RenderingBaseContext = {
	console: Console;
	Date: DateConstructor;
	Math: Math;
	setInterval: typeof setInterval;
	clearInterval: typeof clearInterval;
	requestAnimationFrame: (cb: () => void) => void;
	window: {
		innerWidth: number;
		TaskSyncMarkdownLinks: undefined;
	};
	document: {
		body: { classList: FakeClassList };
		getElementById: (id: string) => FakeElement | null;
		querySelector: (selector: string) => FakeElement | null;
	};
	sessions: SessionSummary[];
	activeSessionId: string | null;
	splitViewEnabled: boolean;
	agentOrchestrationEnabled: boolean;
	splitRatio: number;
	vertSplitRatio: number;
	welcomeSection: FakeElement;
	vscode: { postMessage: ReturnType<typeof vi.fn> };
	requestFollowServerActiveSession: ReturnType<typeof vi.fn>;
	getVisibleSessions: () => SessionSummary[];
	isSplitViewLayoutActive: () => boolean;
	escapeHtml: (value: string) => string;
	convertMarkdownLists: (value: string) => string;
	processTableBuffer: (lines: string[]) => string;
	MARKDOWN_MAX_LENGTH: number;
	MAX_TABLE_ROWS: number;
};

function createRenderingHarness() {
	const source = readFileSync(join(__dirname, "rendering.js"), "utf8");
	const sessionsList = new FakeElement("sessions-list");
	const sessionsPanel = new FakeElement("sessions-panel", ["hidden"]);
	const sessionsCollapseCount = new FakeElement("sessions-collapse-count");
	const sessionsCollapseBar = new FakeElement("sessions-collapse-bar", [
		"hidden",
	]);
	const workspaceHub = new FakeElement("workspace-hub", ["panel", "hub-shell"]);
	const threadShell = new FakeElement("thread-shell", [
		"panel",
		"thread-shell",
		"hidden",
	]);
	const splitPlaceholder = new FakeElement("split-placeholder", ["hidden"]);
	const threadHead = new FakeElement("thread-head");
	const inputArea = new FakeElement("input-area-container");
	const threadTitle = new FakeElement("thread-title");
	const threadBackBtn = new FakeElement("thread-back-btn", [
		"back",
		"icon-btn",
	]);
	threadBackBtn.title = "Back to Sessions";
	const splitResizer = new FakeElement("split-resizer", ["hidden"]);
	const remoteSplitBtn = new FakeElement("remote-split-btn");
	const welcomeSection = new FakeElement("welcome-section");
	const container = new FakeElement("main-container", [
		"main-container",
		"orch",
	]);

	const elements = new Map<string, FakeElement>([
		["sessions-list", sessionsList],
		["sessions-panel", sessionsPanel],
		["sessions-collapse-count", sessionsCollapseCount],
		["sessions-collapse-bar", sessionsCollapseBar],
		["workspace-hub", workspaceHub],
		["thread-shell", threadShell],
		["split-placeholder", splitPlaceholder],
		["thread-head", threadHead],
		["input-area-container", inputArea],
		["thread-title", threadTitle],
		["thread-back-btn", threadBackBtn],
		["split-resizer", splitResizer],
		["remote-split-btn", remoteSplitBtn],
	]);

	const baseContext: RenderingBaseContext = {
		console,
		Date,
		Math,
		setInterval,
		clearInterval,
		requestAnimationFrame: (cb: () => void) => cb(),
		window: {
			innerWidth: 900,
			TaskSyncMarkdownLinks: undefined,
		},
		document: {
			body: { classList: new FakeClassList() },
			getElementById: (id: string) => elements.get(id) || null,
			querySelector: (selector: string) => {
				if (selector === ".main-container.orch") {
					return container;
				}
				return null;
			},
		},
		sessions: [],
		activeSessionId: null,
		splitViewEnabled: false,
		agentOrchestrationEnabled: true,
		splitRatio: 38,
		vertSplitRatio: 35,
		welcomeSection,
		vscode: { postMessage: vi.fn() },
		requestFollowServerActiveSession: vi.fn(),
		getVisibleSessions: () => baseContext.sessions,
		isSplitViewLayoutActive: () =>
			baseContext.agentOrchestrationEnabled &&
			baseContext.splitViewEnabled &&
			baseContext.activeSessionId !== null,
		escapeHtml: (value: string) => value,
		convertMarkdownLists: (value: string) => value,
		processTableBuffer: (lines: string[]) => lines.join("\n"),
		MARKDOWN_MAX_LENGTH: 10000,
		MAX_TABLE_ROWS: 50,
	};

	vm.runInNewContext(source, baseContext);

	type RenderingHarnessContext = typeof baseContext & {
		renderSessionsList: () => void;
		updateWelcomeSectionVisibility: () => void;
		toggleHubCollapse: () => void;
	};

	const context = baseContext as unknown as RenderingHarnessContext;

	return {
		context,
		elements: {
			sessionsList,
			sessionsCollapseBar,
			workspaceHub,
			threadBackBtn,
			threadTitle,
		},
	};
}

describe("rendering unread indicators", () => {
	it("renders row-level unread markers only for unread sessions", () => {
		const { context, elements } = createRenderingHarness();

		context.sessions = [
			{
				id: "session-1",
				title: "Visible thread",
				status: "active",
				waitingOnUser: false,
				unread: false,
				createdAt: 20,
				history: [],
			},
			{
				id: "session-2",
				title: "Needs input",
				status: "active",
				waitingOnUser: true,
				unread: true,
				createdAt: 10,
				history: [{ prompt: "Please confirm" }],
			},
		];
		context.activeSessionId = "session-1";

		context.renderSessionsList();

		const unreadRows =
			elements.sessionsList.innerHTML.match(/chat-row[^"]* unread\b/g) || [];
		expect(unreadRows).toHaveLength(1);
		expect(elements.sessionsList.innerHTML).toContain("Needs input");
		expect(elements.sessionsList.innerHTML).not.toContain(
			'chat-row active unread" data-session-id="session-1"',
		);
	});

	it("shows a generic unread indicator on the return-to-list control in single-view thread mode", () => {
		const { context, elements } = createRenderingHarness();

		context.sessions = [
			{ id: "session-1", title: "Open", unread: false },
			{ id: "session-2", title: "Unread", unread: true },
		];
		context.activeSessionId = "session-1";
		context.splitViewEnabled = false;
		context.window.innerWidth = 900;

		context.updateWelcomeSectionVisibility();

		expect(
			elements.threadBackBtn.classList.contains("has-unread-indicator"),
		).toBe(true);
		expect(
			elements.sessionsCollapseBar.classList.contains("has-unread-indicator"),
		).toBe(false);
		expect(elements.threadTitle.textContent).toBe("Open");
	});

	it("suppresses the generic indicator when split view keeps the sessions list visible", () => {
		const { context, elements } = createRenderingHarness();

		context.sessions = [
			{ id: "session-1", title: "Open", unread: false },
			{ id: "session-2", title: "Unread", unread: true },
		];
		context.activeSessionId = "session-1";
		context.splitViewEnabled = true;
		context.window.innerWidth = 900;

		context.updateWelcomeSectionVisibility();

		expect(
			elements.threadBackBtn.classList.contains("has-unread-indicator"),
		).toBe(false);
		expect(
			elements.sessionsCollapseBar.classList.contains("has-unread-indicator"),
		).toBe(false);
	});

	it("shows the generic unread indicator on the collapsed sessions bar in narrow split mode", () => {
		const { context, elements } = createRenderingHarness();

		context.sessions = [
			{ id: "session-1", title: "Open", unread: false },
			{ id: "session-2", title: "Unread", unread: true },
		];
		context.activeSessionId = "session-1";
		context.splitViewEnabled = true;
		context.window.innerWidth = 400;
		elements.workspaceHub.classList.add("collapsed");

		context.updateWelcomeSectionVisibility();

		expect(
			elements.sessionsCollapseBar.classList.contains("has-unread-indicator"),
		).toBe(true);
		expect(
			elements.threadBackBtn.classList.contains("has-unread-indicator"),
		).toBe(false);
	});

	it("removes the hidden-list indicator when the narrow split hub expands and keeps row markers intact", () => {
		const { context, elements } = createRenderingHarness();

		context.sessions = [
			{
				id: "session-1",
				title: "Open",
				unread: false,
				status: "active",
				waitingOnUser: false,
				createdAt: 20,
				history: [],
			},
			{
				id: "session-2",
				title: "Unread",
				unread: true,
				status: "active",
				waitingOnUser: true,
				createdAt: 10,
				history: [{ prompt: "Please confirm" }],
			},
		];
		context.activeSessionId = "session-1";
		context.splitViewEnabled = true;
		context.window.innerWidth = 400;
		elements.workspaceHub.classList.add("collapsed");

		context.renderSessionsList();
		context.updateWelcomeSectionVisibility();
		expect(
			elements.sessionsCollapseBar.classList.contains("has-unread-indicator"),
		).toBe(true);

		context.toggleHubCollapse();

		expect(elements.workspaceHub.classList.contains("collapsed")).toBe(false);
		expect(
			elements.sessionsCollapseBar.classList.contains("has-unread-indicator"),
		).toBe(false);
		expect(elements.sessionsList.innerHTML).toMatch(/chat-row[^"]* unread\b/);
	});

	it("clears stale generic indicator classes across single-view and split-layout transitions", () => {
		const { context, elements } = createRenderingHarness();

		context.sessions = [
			{ id: "session-1", title: "Open", unread: false },
			{ id: "session-2", title: "Unread", unread: true },
		];
		context.activeSessionId = "session-1";

		context.splitViewEnabled = false;
		context.window.innerWidth = 900;
		context.updateWelcomeSectionVisibility();
		expect(
			elements.threadBackBtn.classList.contains("has-unread-indicator"),
		).toBe(true);

		context.splitViewEnabled = true;
		context.window.innerWidth = 900;
		context.updateWelcomeSectionVisibility();
		expect(
			elements.threadBackBtn.classList.contains("has-unread-indicator"),
		).toBe(false);
		expect(
			elements.sessionsCollapseBar.classList.contains("has-unread-indicator"),
		).toBe(false);

		context.window.innerWidth = 400;
		elements.workspaceHub.classList.add("collapsed");
		context.updateWelcomeSectionVisibility();
		expect(
			elements.sessionsCollapseBar.classList.contains("has-unread-indicator"),
		).toBe(true);

		context.window.innerWidth = 900;
		elements.workspaceHub.classList.remove("collapsed");
		context.updateWelcomeSectionVisibility();
		expect(
			elements.threadBackBtn.classList.contains("has-unread-indicator"),
		).toBe(false);
		expect(
			elements.sessionsCollapseBar.classList.contains("has-unread-indicator"),
		).toBe(false);
	});
});
