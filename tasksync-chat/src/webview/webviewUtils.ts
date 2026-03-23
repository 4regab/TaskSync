import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { CONFIG_SECTION } from "../constants/remoteConstants";
import { generateId } from "../utils/generateId";
import type { P, ToolCallEntry } from "./webviewTypes";

export { generateId };

/**
 * Debug log — only outputs when `tasksync.debugLogging` is enabled.
 * Uses console.error to appear in the VS Code debug console.
 */
export function debugLog(...args: unknown[]): void {
	if (
		vscode.workspace
			.getConfiguration(CONFIG_SECTION)
			.get<boolean>("debugLogging", false)
	) {
		console.error("[TaskSync]", ...args);
	}
}

/** Returns true when the queue is enabled and has pending items. */
export function hasQueuedItems(p: P): boolean {
	return p._queueEnabled && p._promptQueue.length > 0;
}

/**
 * Merge two ToolCallEntry arrays, deduplicate by ID (first occurrence wins),
 * sort by timestamp descending, and cap at maxEntries.
 */
export function mergeAndDedup(
	primary: ToolCallEntry[],
	secondary: ToolCallEntry[],
	maxEntries: number,
): ToolCallEntry[] {
	const seen = new Set<string>();
	return [...primary, ...secondary]
		.filter((entry) => {
			if (seen.has(entry.id)) return false;
			seen.add(entry.id);
			return true;
		})
		.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
		.slice(0, maxEntries);
}

/**
 * Increment queue version, persist, update UI, and broadcast to remote.
 */
export function notifyQueueChanged(p: P): void {
	p._queueVersion++;
	debugLog(
		`[TaskSync] notifyQueueChanged — queueVersion: ${p._queueVersion}, queueSize: ${p._promptQueue.length}, queueEnabled: ${p._queueEnabled}`,
	);
	p._saveQueueToDisk();
	p._updateQueueUI();
	p._remoteServer?.broadcast("queueChanged", {
		queue: p._promptQueue.map((q) => ({
			...q,
			attachments: q.attachments || [],
		})),
		queueVersion: p._queueVersion,
	});
}

/**
 * Broadcast a toolCallCompleted event to remote clients.
 */
export function broadcastToolCallCompleted(
	p: P,
	entry: ToolCallEntry,
	sessionTerminated?: boolean,
): void {
	debugLog(
		`[TaskSync] broadcastToolCallCompleted — id: ${entry.id}, status: ${entry.status}, response: "${(entry.response || "").slice(0, 60)}", summary: ${entry.summary ? `"${entry.summary.slice(0, 40)}"` : "(none)"}, sessionTerminated: ${!!sessionTerminated}`,
	);
	p._remoteServer?.broadcast("toolCallCompleted", {
		id: entry.id,
		entry: {
			id: entry.id,
			prompt: entry.prompt,
			summary: entry.summary,
			response: entry.response,
			timestamp: entry.timestamp,
			status: entry.status,
			attachments: entry.attachments,
			isFromQueue: entry.isFromQueue,
		},
		sessionTerminated: sessionTerminated || false,
	});
}

/**
 * Mark the current session as terminated and freeze the timer.
 */
export function markSessionTerminated(p: P): void {
	debugLog(
		`[TaskSync] markSessionTerminated — sessionStartTime: ${p._sessionStartTime}, aiTurnActive was: ${p._aiTurnActive}`,
	);
	p._sessionTerminated = true;
	p._aiTurnActive = false;
	if (p._sessionStartTime !== null) {
		p._sessionFrozenElapsed = Date.now() - p._sessionStartTime;
		p._stopSessionTimerInterval();
		p._updateViewTitle();
	}
}

/**
 * Format milliseconds into a human-readable elapsed time string.
 */
export function formatElapsed(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) {
		return `${hours}h ${minutes}m ${seconds}s`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds}s`;
	}
	return `${seconds}s`;
}

/**
 * Generate a random delay (jitter) between min and max seconds.
 * Returns 0 if disabled.
 */
export function getHumanLikeDelayMs(
	enabled: boolean,
	minSec: number,
	maxSec: number,
): number {
	if (!enabled) {
		return 0;
	}
	const minMs = minSec * 1000;
	const maxMs = maxSec * 1000;
	return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

/**
 * Generate a cryptographically secure nonce for CSP.
 */
export function getNonce(): string {
	return crypto.randomBytes(16).toString("hex");
}

/**
 * Get file icon based on extension.
 */
export function getFileIcon(filename: string): string {
	const ext = filename.split(".").pop()?.toLowerCase() || "";
	return FILE_ICON_MAP[ext] || "file";
}

/** Map file extensions to codicon icon names. */
const FILE_ICON_MAP: Record<string, string> = {
	ts: "file-code",
	tsx: "file-code",
	js: "file-code",
	jsx: "file-code",
	py: "file-code",
	java: "file-code",
	c: "file-code",
	cpp: "file-code",
	html: "file-code",
	css: "file-code",
	scss: "file-code",
	json: "json",
	yaml: "file-code",
	yml: "file-code",
	md: "markdown",
	txt: "file-text",
	png: "file-media",
	jpg: "file-media",
	jpeg: "file-media",
	gif: "file-media",
	svg: "file-media",
	sh: "terminal",
	bash: "terminal",
	ps1: "terminal",
	zip: "file-zip",
	tar: "file-zip",
	gz: "file-zip",
};

/**
 * Parse file link target in format "path#Lx" or "path#Lx-Ly".
 */
export function parseFileLinkTarget(target: string): {
	filePath: string;
	startLine: number | null;
	endLine: number | null;
} {
	const trimmedTarget = target.trim();
	const match = /^(.*?)(?:#L(\d+)(?:-L(\d+))?)?$/.exec(trimmedTarget);
	const parseLine = (value: string | undefined): number | null => {
		if (!value) {
			return null;
		}
		const parsedValue = Number.parseInt(value, 10);
		return Number.isFinite(parsedValue) ? parsedValue : null;
	};

	const filePath = (match?.[1] ?? trimmedTarget).trim();
	const startLine = parseLine(match?.[2]);
	const endLine = parseLine(match?.[3]);

	return { filePath, startLine, endLine };
}

/**
 * Resolve a file link path to an existing file URI.
 */
export function resolveFileLinkUri(rawPath: string): vscode.Uri | null {
	const normalizedPath = rawPath.trim().replace(/^\.\//, "").trim();
	if (!normalizedPath) {
		return null;
	}

	try {
		const parsedUri = vscode.Uri.parse(normalizedPath);
		if (
			parsedUri.scheme === "file" &&
			fs.existsSync(parsedUri.fsPath) &&
			fs.statSync(parsedUri.fsPath).isFile()
		) {
			return parsedUri;
		}
	} catch {
		// Treat as path when parsing as URI fails.
	}

	if (path.isAbsolute(normalizedPath)) {
		if (fs.existsSync(normalizedPath) && fs.statSync(normalizedPath).isFile()) {
			return vscode.Uri.file(path.resolve(normalizedPath));
		}
		return null;
	}

	const workspaceFolders = vscode.workspace.workspaceFolders || [];
	if (workspaceFolders.length === 0) {
		return null;
	}

	for (const folder of workspaceFolders) {
		const candidatePath = path.resolve(folder.uri.fsPath, normalizedPath);
		if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
			return vscode.Uri.file(candidatePath);
		}
	}

	return null;
}
