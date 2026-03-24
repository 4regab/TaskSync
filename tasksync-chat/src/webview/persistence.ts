import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { P, ToolCallEntry } from "./webviewTypes";
import { mergeAndDedup } from "./webviewUtils";

/**
 * Get workspace-aware storage URI.
 */
export function getStorageUri(p: P): vscode.Uri {
	return p._context.storageUri || p._context.globalStorageUri;
}

/**
 * Load queue from disk (async).
 */
export async function loadQueueFromDiskAsync(p: P): Promise<void> {
	try {
		const storagePath = getStorageUri(p).fsPath;
		const queuePath = path.join(storagePath, "queue.json");

		try {
			await fs.promises.access(queuePath, fs.constants.F_OK);
		} catch {
			p._promptQueue = [];
			p._queueEnabled = true;
			return;
		}

		const data = await fs.promises.readFile(queuePath, "utf8");
		const parsed = JSON.parse(data);
		p._promptQueue = Array.isArray(parsed.queue) ? parsed.queue : [];
		p._queueEnabled = parsed.enabled !== false;
	} catch (error) {
		console.error("[TaskSync] Failed to load queue:", error);
		p._promptQueue = [];
		p._queueEnabled = true;
	}
}

/**
 * Save queue to disk (debounced).
 */
export function saveQueueToDisk(p: P): void {
	if (p._queueSaveTimer) {
		clearTimeout(p._queueSaveTimer);
	}
	p._queueSaveTimer = setTimeout(() => {
		saveQueueToDiskAsync(p);
	}, p._QUEUE_SAVE_DEBOUNCE_MS);
}

/**
 * Actually persist queue to disk.
 */
export async function saveQueueToDiskAsync(p: P): Promise<void> {
	try {
		const storagePath = getStorageUri(p).fsPath;
		const queuePath = path.join(storagePath, "queue.json");

		await fs.promises.mkdir(storagePath, { recursive: true });

		const data = JSON.stringify(
			{
				queue: p._promptQueue,
				enabled: p._queueEnabled,
			},
			null,
			2,
		);

		await fs.promises.writeFile(queuePath, data, "utf8");
	} catch (error) {
		console.error("[TaskSync] Failed to save queue:", error);
	}
}

/**
 * Load persisted history from disk (async).
 */
export async function loadPersistedHistoryFromDiskAsync(p: P): Promise<void> {
	try {
		const storagePath = getStorageUri(p).fsPath;
		const historyPath = path.join(storagePath, "tool-history.json");

		try {
			await fs.promises.access(historyPath, fs.constants.F_OK);
		} catch {
			p._persistedHistory = [];
			return;
		}

		const data = await fs.promises.readFile(historyPath, "utf8");
		const parsed = JSON.parse(data);
		p._persistedHistory = Array.isArray(parsed.history)
			? parsed.history
				.filter((entry: ToolCallEntry) => entry.status === "completed")
				.slice(0, p._MAX_HISTORY_ENTRIES)
			: [];
	} catch (error) {
		console.error("[TaskSync] Failed to load persisted history:", error);
		p._persistedHistory = [];
	}
}

/**
 * Save persisted history to disk (debounced async).
 */
export function savePersistedHistoryToDisk(p: P): void {
	p._historyDirty = true;

	if (p._historySaveTimer) {
		clearTimeout(p._historySaveTimer);
	}

	p._historySaveTimer = setTimeout(() => {
		savePersistedHistoryToDiskAsync(p);
	}, p._HISTORY_SAVE_DEBOUNCE_MS);
}

/**
 * Async save persisted history (non-blocking background save).
 */
export async function savePersistedHistoryToDiskAsync(p: P): Promise<void> {
	try {
		const storagePath = getStorageUri(p).fsPath;
		const historyPath = path.join(storagePath, "tool-history.json");

		try {
			await fs.promises.access(storagePath);
		} catch {
			await fs.promises.mkdir(storagePath, { recursive: true });
		}

		const completedHistory = p._persistedHistory.filter(
			(entry: ToolCallEntry) => entry.status === "completed",
		);

		let merged = completedHistory;
		try {
			const existing = await fs.promises.readFile(historyPath, "utf8");
			const parsed = JSON.parse(existing);
			if (Array.isArray(parsed.history)) {
				merged = mergeAndDedup(
					completedHistory,
					parsed.history,
					p._MAX_HISTORY_ENTRIES,
				);
			}
		} catch {
			// File doesn't exist or is invalid
		}

		p._persistedHistory = merged;

		const data = JSON.stringify({ history: merged }, null, 2);
		await fs.promises.writeFile(historyPath, data, "utf8");
		p._historyDirty = false;
	} catch (error) {
		console.error(
			"[TaskSync] Failed to save persisted history (async):",
			error,
		);
	}
}

/**
 * Synchronous save persisted history (only for deactivate).
 */
export function savePersistedHistoryToDiskSync(p: P): void {
	if (!p._historyDirty) return;

	try {
		const storagePath = getStorageUri(p).fsPath;
		const historyPath = path.join(storagePath, "tool-history.json");

		if (!fs.existsSync(storagePath)) { // sync-io-allowed: deactivation hook must complete before process exits
			fs.mkdirSync(storagePath, { recursive: true }); // sync-io-allowed
		}

		const completedHistory = p._persistedHistory.filter(
			(entry: ToolCallEntry) => entry.status === "completed",
		);

		let merged = completedHistory;
		try {
			const existing = fs.readFileSync(historyPath, "utf8"); // sync-io-allowed
			const parsed = JSON.parse(existing);
			if (Array.isArray(parsed.history)) {
				merged = mergeAndDedup(
					completedHistory,
					parsed.history,
					p._MAX_HISTORY_ENTRIES,
				);
			}
		} catch {
			// File doesn't exist or is invalid
		}

		p._persistedHistory = merged;

		const data = JSON.stringify({ history: merged }, null, 2);
		fs.writeFileSync(historyPath, data, "utf8"); // sync-io-allowed
		p._historyDirty = false;
	} catch (error) {
		console.error("[TaskSync] Failed to save persisted history:", error);
	}
}
