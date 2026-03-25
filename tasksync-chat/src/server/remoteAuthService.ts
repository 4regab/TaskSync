import * as crypto from "crypto";
import * as vscode from "vscode";
import type { WebSocket } from "ws";
import { WS_PROTOCOL_VERSION } from "../constants/remoteConstants";
import { getSafeErrorMessage, sendWsError } from "./serverUtils";

/**
 * Handles authentication for the remote server.
 * Manages PIN auth, session tokens, failed attempts, and lockouts.
 */
export class RemoteAuthService {
	// Authentication state
	pinEnabled: boolean = true;
	pin: string = "";
	maxDevices: number = 2;
	readonly authenticatedClients: Set<WebSocket> = new Set();

	/** Timing-safe PIN comparison using SHA-256 digests (constant-time). */
	private comparePinTimingSafe(input: string): boolean {
		if (!this.pin) return false;
		const inputDigest = crypto
			.createHash("sha256")
			.update(input, "utf8")
			.digest();
		const expectedDigest = crypto
			.createHash("sha256")
			.update(this.pin, "utf8")
			.digest();
		return crypto.timingSafeEqual(expectedDigest, inputDigest);
	}
	private failedAttempts: Map<
		string,
		{ count: number; lockUntil: number; lastAttemptAt: number }
	> = new Map();
	private sessionTokens: Map<string, { clientIp: string; expiresAt: number }> =
		new Map();
	private failedAttemptsCleanupTimer: ReturnType<typeof setInterval> | null =
		null;

	// Configuration constants
	private readonly SESSION_TOKEN_EXPIRY_MS = 4 * 60 * 60 * 1000; // 4 hours
	private readonly MAX_SESSION_TOKENS = 100;
	private readonly SESSION_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
	private readonly MAX_ATTEMPTS = 5;
	private readonly LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
	private readonly MAX_FAILED_ATTEMPTS_ENTRIES = 1000;

	/** Callback for failed auth attempts (used by server to notify VS Code) */
	onAuthFailure?: (
		clientIp: string,
		attemptCount: number,
		lockedOut: boolean,
	) => void;

	/**
	 * Get the current attempt entry, automatically clearing expired lockouts.
	 */
	private getActiveAttempt(
		clientIp: string,
	): { count: number; lockUntil: number; lastAttemptAt: number } | undefined {
		const attempt = this.failedAttempts.get(clientIp);
		if (!attempt) {
			return undefined;
		}

		if (attempt.lockUntil > 0 && attempt.lockUntil <= Date.now()) {
			this.failedAttempts.delete(clientIp);
			return undefined;
		}

		return attempt;
	}

	constructor(_context: vscode.ExtensionContext) {}

	/**
	 * Handle PIN/session-token authentication for a WebSocket client.
	 */
	handleAuth(
		ws: WebSocket,
		clientIp: string,
		pin: string | undefined,
		sessionToken: string | undefined,
		getState: () => unknown,
		gitServiceAvailable: boolean,
	): void {
		let state;
		try {
			state = getState();
		} catch (err) {
			console.error(
				"[TaskSync Remote] Error getting state:",
				getSafeErrorMessage(err),
			);
			sendWsError(ws, "Internal server error");
			return;
		}

		if (!this.pinEnabled) {
			// In no-PIN mode, handleConnection already authenticated this client
			// and sent 'connected' with state. Skip duplicate authSuccess.
			if (!this.authenticatedClients.has(ws)) {
				this.authenticatedClients.add(ws);
				ws.send(
					JSON.stringify({
						type: "authSuccess",
						state,
						gitServiceAvailable,
						protocolVersion: WS_PROTOCOL_VERSION,
					}),
				);
			}
			return;
		}

		// Enforce max device limit (skip for already-authenticated clients)
		if (
			!this.authenticatedClients.has(ws) &&
			this.authenticatedClients.size >= this.maxDevices
		) {
			ws.send(
				JSON.stringify({
					type: "authFailed",
					message: `Maximum connected devices reached (${this.maxDevices}). Disconnect another device first.`,
				}),
			);
			return;
		}

		// Try session token auth first (for reconnections)
		if (sessionToken && typeof sessionToken === "string") {
			if (!this.SESSION_TOKEN_PATTERN.test(sessionToken)) {
				// Ignore malformed token and continue to PIN auth path.
				sessionToken = undefined;
			}
		}

		if (sessionToken && typeof sessionToken === "string") {
			const tokenData = this.sessionTokens.get(sessionToken);
			if (
				tokenData &&
				tokenData.clientIp === clientIp &&
				tokenData.expiresAt > Date.now()
			) {
				// Valid session token - authenticate without PIN
				// Rotate token on use to reduce replay window.
				this.sessionTokens.delete(sessionToken);
				const rotatedSessionToken = this.generateSessionToken(clientIp);
				this.authenticatedClients.add(ws);
				ws.send(
					JSON.stringify({
						type: "authSuccess",
						state,
						gitServiceAvailable,
						sessionToken: rotatedSessionToken,
						protocolVersion: WS_PROTOCOL_VERSION,
					}),
				);
				return;
			}
			// Invalid/expired token, fall through to PIN auth
			this.sessionTokens.delete(sessionToken);
		}

		const attempt = this.getActiveAttempt(clientIp);
		if (attempt && attempt.lockUntil > Date.now()) {
			const remaining = Math.ceil((attempt.lockUntil - Date.now()) / 60000);
			ws.send(
				JSON.stringify({
					type: "authFailed",
					message: `Locked. ${remaining}m remaining.`,
				}),
			);
			return;
		}

		// Timing-safe comparison
		const valid = this.comparePinTimingSafe(String(pin || ""));

		if (!valid) {
			const count = (attempt?.count ?? 0) + 1;
			const lockedOut = count >= this.MAX_ATTEMPTS;
			this.failedAttempts.set(clientIp, {
				count,
				lockUntil: lockedOut ? Date.now() + this.LOCKOUT_MS : 0,
				lastAttemptAt: Date.now(),
			});
			const remainingAttempts = Math.max(0, this.MAX_ATTEMPTS - count);
			ws.send(
				JSON.stringify({
					type: "authFailed",
					message: lockedOut
						? `Too many failed attempts. Locked for ${Math.ceil(this.LOCKOUT_MS / 60000)}m.`
						: `Wrong code. ${remainingAttempts} attempts left.`,
				}),
			);
			this.onAuthFailure?.(clientIp, count, lockedOut);
			return;
		}

		this.failedAttempts.delete(clientIp);
		this.authenticatedClients.add(ws);

		// Generate session token for future reconnections
		const newSessionToken = this.generateSessionToken(clientIp);

		ws.send(
			JSON.stringify({
				type: "authSuccess",
				state,
				gitServiceAvailable,
				sessionToken: newSessionToken,
				protocolVersion: WS_PROTOCOL_VERSION,
			}),
		);
	}

	/**
	 * Generate and store a session token for the client.
	 */
	private generateSessionToken(clientIp: string): string {
		// Cleanup expired tokens and enforce limit
		const now = Date.now();
		for (const [token, data] of this.sessionTokens) {
			if (data.expiresAt < now) {
				this.sessionTokens.delete(token);
			}
		}
		// If still at limit, remove oldest
		if (this.sessionTokens.size >= this.MAX_SESSION_TOKENS) {
			const oldest = this.sessionTokens.keys().next().value;
			if (oldest) this.sessionTokens.delete(oldest);
		}

		const token = crypto.randomBytes(32).toString("hex");
		this.sessionTokens.set(token, {
			clientIp,
			expiresAt: now + this.SESSION_TOKEN_EXPIRY_MS,
		});
		return token;
	}

	/**
	 * Verify HTTP API authentication via PIN header or query param.
	 * Includes failed-attempt tracking and lockout (mirrors WebSocket auth).
	 */
	verifyHttpAuth(
		req: import("http").IncomingMessage,
		url: URL,
	): { allowed: boolean; lockedOut?: boolean } {
		if (!this.pinEnabled) return { allowed: true };

		const clientIp = this.normalizeIp(req.socket.remoteAddress || "");

		// Prefer session token auth for API requests from active remote app sessions.
		// This avoids OTP-rotation failures while still binding tokens to client IP.
		const headerToken = req.headers[
			"x-tasksync-session"
		] as string | undefined;
		const queryToken = url.searchParams.get("sessionToken") ?? undefined;
		const suppliedToken = headerToken ?? queryToken;
		if (suppliedToken && this.SESSION_TOKEN_PATTERN.test(suppliedToken)) {
			const tokenData = this.sessionTokens.get(suppliedToken);
			if (
				tokenData &&
				tokenData.clientIp === clientIp &&
				tokenData.expiresAt > Date.now()
			) {
				// Sliding expiry while actively used.
				tokenData.expiresAt = Date.now() + this.SESSION_TOKEN_EXPIRY_MS;
				this.failedAttempts.delete(clientIp);
				return { allowed: true };
			}
			// Remove stale/invalid tokens.
			this.sessionTokens.delete(suppliedToken);
		}

		// Check lockout (shared with WebSocket auth)
		const attempt = this.getActiveAttempt(clientIp);
		if (attempt && attempt.lockUntil > Date.now()) {
			return { allowed: false, lockedOut: true };
		}

		const headerPin = req.headers["x-tasksync-pin"] as string | undefined;
		const queryPin = url.searchParams.get("pin") ?? undefined;
		const suppliedPin = headerPin ?? queryPin ?? "";

		const valid = this.comparePinTimingSafe(suppliedPin);

		if (!valid) {
			const count = (attempt?.count ?? 0) + 1;
			const lockedOut = count >= this.MAX_ATTEMPTS;
			this.failedAttempts.set(clientIp, {
				count,
				lockUntil: lockedOut ? Date.now() + this.LOCKOUT_MS : 0,
				lastAttemptAt: Date.now(),
			});
			this.onAuthFailure?.(clientIp, count, lockedOut);
			return { allowed: false };
		}

		this.failedAttempts.delete(clientIp);
		return { allowed: true };
	}

	/**
	 * Generate a new 6-digit PIN. Called once per server start.
	 * Not persisted — a fresh PIN is created each time the server starts.
	 */
	getOrCreatePin(): string {
		if (!this.pin) {
			this.pin = crypto.randomInt(100000, 1000000).toString();
		}
		return this.pin;
	}

	/**
	 * Clear all session tokens (e.g., on PIN change).
	 */
	clearSessionTokens(): void {
		this.sessionTokens.clear();
	}

	/**
	 * Start periodic cleanup of expired failed attempt entries.
	 */
	private readonly STALE_ATTEMPT_MS = 60 * 60 * 1000; // 1 hour — cleanup unlocked entries

	startFailedAttemptsCleanup(): void {
		if (this.failedAttemptsCleanupTimer) return;
		this.failedAttemptsCleanupTimer = setInterval(
			() => {
				const now = Date.now();
				for (const [ip, attempt] of this.failedAttempts.entries()) {
					// Remove expired lockouts
					if (attempt.lockUntil > 0 && attempt.lockUntil < now) {
						this.failedAttempts.delete(ip);
						continue;
					}
					// Remove stale entries that never triggered lockout (below threshold)
					if (
						attempt.lockUntil === 0 &&
						now - attempt.lastAttemptAt > this.STALE_ATTEMPT_MS
					) {
						this.failedAttempts.delete(ip);
					}
				}
				if (this.failedAttempts.size > this.MAX_FAILED_ATTEMPTS_ENTRIES) {
					const toDelete =
						this.failedAttempts.size - this.MAX_FAILED_ATTEMPTS_ENTRIES;
					let deleted = 0;
					for (const ip of this.failedAttempts.keys()) {
						if (deleted >= toDelete) break;
						this.failedAttempts.delete(ip);
						deleted++;
					}
				}
			},
			5 * 60 * 1000,
		);
	}

	/**
	 * Clean up all auth state (called on server stop).
	 */
	cleanup(): void {
		if (this.failedAttemptsCleanupTimer) {
			clearInterval(this.failedAttemptsCleanupTimer);
			this.failedAttemptsCleanupTimer = null;
		}
		this.authenticatedClients.clear();
		this.failedAttempts.clear();
		this.sessionTokens.clear();
	}

	/**
	 * Remove a client from authenticated set (called on disconnect).
	 */
	removeClient(ws: WebSocket): void {
		this.authenticatedClients.delete(ws);
	}

	/**
	 * Normalize client IP address (strip IPv6-mapped IPv4 prefix).
	 */
	normalizeIp(ip: string): string {
		return ip.replace(/^::ffff:/, "");
	}
}
