import * as crypto from "crypto";
import * as http from "http";
import * as https from "https";
import * as os from "os";
import selfsigned from "selfsigned";
import type { WebSocket } from "ws";
import {
	MAX_ATTACHMENT_NAME_LENGTH,
	MAX_ATTACHMENT_URI_LENGTH,
	MAX_ATTACHMENTS,
} from "../constants/remoteConstants";
import type { AttachmentInfo } from "../webview/webviewProvider";

/**
 * Send a typed error response over a WebSocket connection.
 *
 * Note: WS errors use `{ type: "error", message, code? }` shape.
 * HTTP API errors use `{ error: "message" }` shape (see remoteHtmlService.ts).
 * Both shapes are handled by the adapter.js client.
 */
export function sendWsError(
	ws: WebSocket,
	message: string,
	code?: string,
): void {
	try {
		ws.send(
			JSON.stringify(
				code ? { type: "error", code, message } : { type: "error", message },
			),
		);
	} catch {
		// Socket may be closing/closed
	}
}

/**
 * Safely extract an error message from an unknown thrown value.
 * Returns a generic message for non-Error values to avoid leaking internals.
 */
export function getSafeErrorMessage(
	err: unknown,
	fallback = "An unexpected error occurred",
): string {
	if (err instanceof Error) return err.message;
	return fallback;
}

/**
 * Set standard security headers on HTTP responses.
 * Prevents MIME sniffing, clickjacking, and Referer-based PIN leakage.
 * When `isTls` is true, adds HSTS header to enforce HTTPS.
 */
export function setSecurityHeaders(
	res: http.ServerResponse,
	isTls?: boolean,
): void {
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("X-Frame-Options", "DENY");
	res.setHeader("Referrer-Policy", "no-referrer");
	if (isTls) {
		res.setHeader("Strict-Transport-Security", "max-age=31536000");
	}
}

/**
 * Validate that the Origin header matches the request Host.
 * Returns true if origin is allowed (or missing), false if cross-origin.
 *
 * Design: Missing Origin header is intentionally allowed because:
 * 1. Browsers always send Origin on cross-origin requests — this check blocks cross-site attacks.
 * 2. Non-browser clients (curl, scripts) omit Origin but must still authenticate via PIN.
 * This is a defense-in-depth layer, not the primary auth mechanism.
 */
export function isOriginAllowed(req: http.IncomingMessage): boolean {
	const origin = req.headers.origin;
	if (!origin) {
		// Non-browser client or same-origin — Origin header absent, allow through
		return true;
	}
	try {
		const originHost = new URL(origin).host;
		const requestHost = req.headers.host || "";
		return originHost === requestHost;
	} catch {
		return false;
	}
}

/**
 * Normalize and validate attachment arrays from remote messages.
 * Generates UUIDs for missing/invalid attachment IDs.
 */
export function normalizeAttachments(raw: unknown): AttachmentInfo[] {
	if (!Array.isArray(raw)) return [];
	const attachments: AttachmentInfo[] = [];
	for (
		let idx = 0;
		idx < raw.length && attachments.length < MAX_ATTACHMENTS;
		idx++
	) {
		const a = raw[idx];
		if (!a || typeof a !== "object") continue;
		if (typeof a.uri !== "string" || a.uri.length > MAX_ATTACHMENT_URI_LENGTH)
			continue;
		if (
			typeof a.name !== "string" ||
			a.name.length > MAX_ATTACHMENT_NAME_LENGTH
		)
			continue;
		// Use client-provided ID only if it's a reasonable string; otherwise generate a UUID
		const id =
			typeof a.id === "string" && a.id.length > 0 && a.id.length <= 128
				? a.id
				: crypto.randomUUID();
		attachments.push({ id, name: a.name, uri: a.uri });
	}
	return attachments;
}

/** Get the preferred local IPv4 address, favouring physical interfaces. */
export function getLocalIp(): string {
	const nets = os.networkInterfaces();
	const preferredPrefixes = ["en", "eth", "wlan", "Wi-Fi", "Ethernet"];
	let fallback: string | null = null;
	for (const name of Object.keys(nets)) {
		for (const net of nets[name] || []) {
			if (net.family === "IPv4" && !net.internal) {
				if (preferredPrefixes.some((p) => name.startsWith(p)))
					return net.address;
				if (!fallback) fallback = net.address;
			}
		}
	}
	return fallback || "127.0.0.1";
}

/** Check whether a TCP port is available for binding. */
export function isPortAvailable(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = http.createServer();
		server.once("error", () => {
			server.close();
			resolve(false);
		});
		server.once("listening", () => server.close(() => resolve(true)));
		server.listen(port, "0.0.0.0");
	});
}

/** Find the first available port starting from `startPort`, checking up to 10 sequential ports. */
export async function findAvailablePort(startPort: number): Promise<number> {
	for (let p = startPort; p < startPort + 10; p++) {
		if (await isPortAvailable(p)) return p;
	}
	throw new Error(`No available ports in range ${startPort}-${startPort + 9}`);
}

/** TLS certificate pair for self-signed HTTPS. */
export interface TlsCert {
	key: string;
	cert: string;
}

/**
 * Generate a self-signed TLS certificate valid for the given hostname/IP.
 * Uses the `selfsigned` package (Node.js built-in crypto backend).
 */
export async function generateSelfSignedCert(host: string): Promise<TlsCert> {
	const attrs = [{ name: "commonName", value: host }];
	const notBefore = new Date();
	const notAfter = new Date();
	notAfter.setFullYear(notAfter.getFullYear() + 1);
	const isIP = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":");
	const altNames = isIP
		? [{ type: 7 as const, ip: host }]
		: [{ type: 2 as const, value: host }];
	const pems = await selfsigned.generate(attrs, {
		keySize: 2048,
		notBeforeDate: notBefore,
		notAfterDate: notAfter,
		extensions: [{ name: "subjectAltName", altNames }],
	});
	return { key: pems.private, cert: pems.cert };
}

/**
 * Create an HTTP or HTTPS server based on TLS configuration.
 * When `tls` is provided, creates an HTTPS server; otherwise plain HTTP.
 */
export function createServer(
	handler: http.RequestListener,
	tls?: TlsCert,
): http.Server | https.Server {
	if (tls) {
		return https.createServer({ key: tls.key, cert: tls.cert }, handler);
	}
	return http.createServer(handler);
}
