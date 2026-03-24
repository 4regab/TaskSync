import * as http from "http";
import * as https from "https";
import { describe, expect, it, vi } from "vitest";
import {
	createServer,
	findAvailablePort,
	generateSelfSignedCert,
	getLocalIp,
	getSafeErrorMessage,
	isOriginAllowed,
	isPortAvailable,
	normalizeAttachments,
	sendWsError,
	setSecurityHeaders,
} from "../server/serverUtils";

// ─── getSafeErrorMessage ─────────────────────────────────────

describe("getSafeErrorMessage", () => {
	it("extracts message from Error instances", () => {
		expect(getSafeErrorMessage(new Error("disk full"))).toBe("disk full");
	});

	it("extracts message from Error subclasses", () => {
		expect(getSafeErrorMessage(new TypeError("bad type"))).toBe("bad type");
		expect(getSafeErrorMessage(new RangeError("out of range"))).toBe(
			"out of range",
		);
	});

	it("returns fallback for non-Error values", () => {
		expect(getSafeErrorMessage("string error")).toBe(
			"An unexpected error occurred",
		);
		expect(getSafeErrorMessage(42)).toBe("An unexpected error occurred");
		expect(getSafeErrorMessage(null)).toBe("An unexpected error occurred");
		expect(getSafeErrorMessage(undefined)).toBe("An unexpected error occurred");
		expect(getSafeErrorMessage({ message: "fake" })).toBe(
			"An unexpected error occurred",
		);
	});

	it("uses custom fallback when provided", () => {
		expect(getSafeErrorMessage("oops", "Custom fallback")).toBe(
			"Custom fallback",
		);
	});
});

// ─── setSecurityHeaders ──────────────────────────────────────

describe("setSecurityHeaders", () => {
	function createMockResponse() {
		const headers: Record<string, string> = {};
		return {
			setHeader: (name: string, value: string) => {
				headers[name] = value;
			},
			headers,
		} as unknown as http.ServerResponse & { headers: Record<string, string> };
	}

	it("sets standard security headers", () => {
		const res = createMockResponse();
		setSecurityHeaders(res);
		expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
		expect(res.headers["X-Frame-Options"]).toBe("DENY");
		expect(res.headers["Referrer-Policy"]).toBe("no-referrer");
	});

	it("does NOT set HSTS when isTls is false/undefined", () => {
		const res = createMockResponse();
		setSecurityHeaders(res);
		expect(res.headers["Strict-Transport-Security"]).toBeUndefined();

		const res2 = createMockResponse();
		setSecurityHeaders(res2, false);
		expect(res2.headers["Strict-Transport-Security"]).toBeUndefined();
	});

	it("sets HSTS when isTls is true", () => {
		const res = createMockResponse();
		setSecurityHeaders(res, true);
		expect(res.headers["Strict-Transport-Security"]).toBe("max-age=31536000");
	});
});

// ─── isOriginAllowed ─────────────────────────────────────────

describe("isOriginAllowed", () => {
	function createMockRequest(
		origin: string | undefined,
		host: string,
	): http.IncomingMessage {
		return {
			headers: {
				...(origin !== undefined ? { origin } : {}),
				host,
			},
			socket: { remoteAddress: "127.0.0.1" },
			method: "GET",
			url: "/",
		} as unknown as http.IncomingMessage;
	}

	it("allows requests without Origin header", () => {
		const req = createMockRequest(undefined, "localhost:3580");
		expect(isOriginAllowed(req)).toBe(true);
	});

	it("allows same-origin requests", () => {
		const req = createMockRequest("http://localhost:3580", "localhost:3580");
		expect(isOriginAllowed(req)).toBe(true);
	});

	it("allows same host with https", () => {
		const req = createMockRequest("https://myhost:3580", "myhost:3580");
		expect(isOriginAllowed(req)).toBe(true);
	});

	it("rejects cross-origin requests", () => {
		const req = createMockRequest("http://evil.com", "localhost:3580");
		expect(isOriginAllowed(req)).toBe(false);
	});

	it("rejects when origin host differs from request host", () => {
		const req = createMockRequest("http://localhost:9999", "localhost:3580");
		expect(isOriginAllowed(req)).toBe(false);
	});

	it("rejects malformed origin URLs", () => {
		const req = createMockRequest("not-a-url", "localhost:3580");
		expect(isOriginAllowed(req)).toBe(false);
	});
});

// ─── normalizeAttachments ────────────────────────────────────

describe("normalizeAttachments", () => {
	it("returns empty array for non-array input", () => {
		expect(normalizeAttachments(null)).toEqual([]);
		expect(normalizeAttachments(undefined)).toEqual([]);
		expect(normalizeAttachments("string")).toEqual([]);
		expect(normalizeAttachments(123)).toEqual([]);
		expect(normalizeAttachments({})).toEqual([]);
	});

	it("returns empty array for empty array", () => {
		expect(normalizeAttachments([])).toEqual([]);
	});

	it("normalizes valid attachments", () => {
		const input = [
			{ id: "att1", name: "file.png", uri: "file:///path/to/file.png" },
		];
		const result = normalizeAttachments(input);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			id: "att1",
			name: "file.png",
			uri: "file:///path/to/file.png",
		});
	});

	it("generates UUID for missing/invalid IDs", () => {
		const input = [{ name: "file.png", uri: "file:///path" }];
		const result = normalizeAttachments(input);
		expect(result).toHaveLength(1);
		expect(result[0].id).toBeTruthy();
		expect(result[0].id.length).toBeGreaterThan(0);
	});

	it("generates UUID for empty string ID", () => {
		const input = [{ id: "", name: "file.png", uri: "file:///path" }];
		const result = normalizeAttachments(input);
		expect(result[0].id).not.toBe("");
	});

	it("skips items without string uri", () => {
		const input = [
			{ id: "a", name: "file.png", uri: 123 },
			{ id: "b", name: "file.png" }, // missing uri
		];
		expect(normalizeAttachments(input)).toEqual([]);
	});

	it("skips items without string name", () => {
		const input = [{ id: "a", name: 123, uri: "file:///path" }];
		expect(normalizeAttachments(input)).toEqual([]);
	});

	it("skips null/undefined items", () => {
		const input = [null, undefined, { id: "a", name: "f", uri: "u" }];
		const result = normalizeAttachments(input);
		expect(result).toHaveLength(1);
	});

	it("enforces MAX_ATTACHMENTS limit", () => {
		const input = Array.from({ length: 30 }, (_, i) => ({
			id: `att_${i}`,
			name: `file${i}.txt`,
			uri: `file:///path/${i}`,
		}));
		const result = normalizeAttachments(input);
		expect(result.length).toBeLessThanOrEqual(20); // MAX_ATTACHMENTS = 20
	});

	it("rejects URIs exceeding MAX_ATTACHMENT_URI_LENGTH", () => {
		const input = [
			{
				id: "a",
				name: "f.txt",
				uri: "x".repeat(1001), // MAX_ATTACHMENT_URI_LENGTH = 1000
			},
		];
		expect(normalizeAttachments(input)).toEqual([]);
	});

	it("rejects names exceeding MAX_ATTACHMENT_NAME_LENGTH", () => {
		const input = [
			{
				id: "a",
				name: "x".repeat(256), // MAX_ATTACHMENT_NAME_LENGTH = 255
				uri: "file:///path",
			},
		];
		expect(normalizeAttachments(input)).toEqual([]);
	});

	it("accepts ID up to 128 chars", () => {
		const input = [
			{
				id: "x".repeat(128),
				name: "f.txt",
				uri: "file:///p",
			},
		];
		const result = normalizeAttachments(input);
		expect(result[0].id).toBe("x".repeat(128));
	});

	it("generates UUID for ID exceeding 128 chars", () => {
		const input = [
			{
				id: "x".repeat(129),
				name: "f.txt",
				uri: "file:///p",
			},
		];
		const result = normalizeAttachments(input);
		expect(result[0].id).not.toBe("x".repeat(129));
	});
});

// ─── sendWsError ─────────────────────────────────────────────

describe("sendWsError", () => {
	function createMockWs() {
		const sent: string[] = [];
		return {
			ws: {
				send: vi.fn((data: string) => {
					sent.push(data);
				}),
			} as any,
			sent,
		};
	}

	it("sends error message without code", () => {
		const { ws, sent } = createMockWs();
		sendWsError(ws, "Something went wrong");
		expect(sent).toHaveLength(1);
		const parsed = JSON.parse(sent[0]);
		expect(parsed).toEqual({ type: "error", message: "Something went wrong" });
		expect(parsed.code).toBeUndefined();
	});

	it("sends error message with code", () => {
		const { ws, sent } = createMockWs();
		sendWsError(ws, "Auth failed", "AUTH_ERROR");
		const parsed = JSON.parse(sent[0]);
		expect(parsed).toEqual({
			type: "error",
			code: "AUTH_ERROR",
			message: "Auth failed",
		});
	});

	it("silently handles send failures", () => {
		const ws = {
			send: vi.fn(() => {
				throw new Error("Socket closed");
			}),
		} as any;
		// Should not throw
		expect(() => sendWsError(ws, "test")).not.toThrow();
	});
});

// ─── getLocalIp ──────────────────────────────────────────────

describe("getLocalIp", () => {
	it("returns a string IP address", () => {
		const ip = getLocalIp();
		expect(typeof ip).toBe("string");
		expect(ip.length).toBeGreaterThan(0);
	});

	it("returns a valid IPv4 format", () => {
		const ip = getLocalIp();
		// Should be either a proper IPv4 or 127.0.0.1 fallback
		expect(ip).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
	});
});

// ─── createServer ────────────────────────────────────────────

describe("createServer", () => {
	it("creates an HTTP server when no TLS config", () => {
		const handler = vi.fn();
		const server = createServer(handler);
		expect(server).toBeInstanceOf(http.Server);
		server.close();
	});

	it("creates an HTTPS server when TLS config provided", async () => {
		const handler = vi.fn();
		const tls = await generateSelfSignedCert("127.0.0.1");
		const server = createServer(handler, tls);
		expect(server).toBeInstanceOf(https.Server);
		server.close();
	});
});

// ─── isPortAvailable ─────────────────────────────────────────

describe("isPortAvailable", () => {
	it("returns true for an available port", async () => {
		// Use port 0 to let OS pick a free port, then check its actual port
		const server = http.createServer();
		await new Promise<void>((resolve) => server.listen(0, resolve));
		const boundPort = (server.address() as { port: number }).port;
		server.close();
		// Wait for close then check the port
		await new Promise<void>((resolve) => server.on("close", resolve));
		const available = await isPortAvailable(boundPort);
		expect(available).toBe(true);
	});

	it("returns false for a port in use", async () => {
		const server = http.createServer();
		await new Promise<void>((resolve) => server.listen(0, resolve));
		const boundPort = (server.address() as { port: number }).port;
		try {
			const available = await isPortAvailable(boundPort);
			expect(available).toBe(false);
		} finally {
			server.close();
		}
	});
});

// ─── findAvailablePort ───────────────────────────────────────

describe("findAvailablePort", () => {
	it("finds an available port starting from a given port", async () => {
		const port = await findAvailablePort(49152);
		expect(typeof port).toBe("number");
		expect(port).toBeGreaterThanOrEqual(49152);
		expect(port).toBeLessThan(49162); // within 10-port range
	});

	it("skips occupied ports and returns next available", async () => {
		// Bind a port, then search starting from it
		const server = http.createServer();
		await new Promise<void>((resolve) => server.listen(0, resolve));
		const boundPort = (server.address() as { port: number }).port;
		try {
			const port = await findAvailablePort(boundPort);
			expect(port).toBeGreaterThan(boundPort);
		} finally {
			server.close();
		}
	});

	it("throws when all 10 ports are occupied", async () => {
		// Bind 10 consecutive ports
		const servers: http.Server[] = [];
		const baseServer = http.createServer();
		await new Promise<void>((resolve) => baseServer.listen(0, resolve));
		const basePort = (baseServer.address() as { port: number }).port;
		servers.push(baseServer);
		for (let i = 1; i < 10; i++) {
			const s = http.createServer();
			await new Promise<void>((resolve) => s.listen(basePort + i, resolve));
			servers.push(s);
		}
		try {
			await expect(findAvailablePort(basePort)).rejects.toThrow(
				/No available ports/,
			);
		} finally {
			for (const s of servers) s.close();
		}
	});
});

// ─── generateSelfSignedCert ──────────────────────────────────

describe("generateSelfSignedCert", () => {
	it("generates a TLS cert with key and cert strings", async () => {
		const result = await generateSelfSignedCert("127.0.0.1");
		expect(typeof result.key).toBe("string");
		expect(typeof result.cert).toBe("string");
		expect(result.key).toContain("PRIVATE KEY");
		expect(result.cert).toContain("CERTIFICATE");
	});

	it("generates valid cert for hostname with port stripped", async () => {
		const result = await generateSelfSignedCert("localhost:3580");
		expect(result.key).toContain("PRIVATE KEY");
		expect(result.cert).toContain("CERTIFICATE");
	});

	it("generates valid cert for bracketed IPv6 with port", async () => {
		const result = await generateSelfSignedCert("[::1]:3580");
		expect(result.key).toContain("PRIVATE KEY");
		expect(result.cert).toContain("CERTIFICATE");
	});

	it("generates valid cert for plain hostname", async () => {
		const result = await generateSelfSignedCert("myhost.local");
		expect(result.cert).toContain("CERTIFICATE");
	});
});
