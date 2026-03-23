import { describe, expect, it, vi } from "vitest";
import { RemoteAuthService } from "./remoteAuthService";

// ─── Helpers ─────────────────────────────────────────────────

function createMockContext() {
    const store = new Map<string, unknown>();
    return {
        globalState: {
            get: (key: string) => store.get(key),
            update: (key: string, value: unknown) => {
                store.set(key, value);
                return Promise.resolve();
            },
        },
    } as any;
}

function createMockWs() {
    const sent: string[] = [];
    return {
        send: (data: string) => sent.push(data),
        _sent: sent,
        _parsed: () => sent.map((s) => JSON.parse(s)),
    };
}

function createService(pin = "123456") {
    const ctx = createMockContext();
    const svc = new RemoteAuthService(ctx);
    svc.pin = pin;
    svc.pinEnabled = true;
    return { svc, ctx };
}

const DUMMY_STATE = { pending: null, queue: [] };
const GET_STATE = () => DUMMY_STATE;

// ─── normalizeIp ─────────────────────────────────────────────

describe("normalizeIp", () => {
    it("strips IPv6-mapped IPv4 prefix", () => {
        const { svc } = createService();
        expect(svc.normalizeIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
    });

    it("passes through plain IPv4", () => {
        const { svc } = createService();
        expect(svc.normalizeIp("192.168.1.1")).toBe("192.168.1.1");
    });

    it("passes through IPv6", () => {
        const { svc } = createService();
        expect(svc.normalizeIp("::1")).toBe("::1");
    });
});

// ─── handleAuth — no-PIN mode ────────────────────────────────

describe("handleAuth — no-PIN mode", () => {
    it("authenticates and sends authSuccess when client not yet authenticated", () => {
        const { svc } = createService();
        svc.pinEnabled = false;
        const ws = createMockWs();

        svc.handleAuth(ws as any, "1.2.3.4", undefined, undefined, GET_STATE, true);

        expect(svc.authenticatedClients.has(ws as any)).toBe(true);
        const msgs = ws._parsed();
        expect(msgs).toHaveLength(1);
        expect(msgs[0].type).toBe("authSuccess");
        expect(msgs[0].gitServiceAvailable).toBe(true);
    });

    it("does not send duplicate authSuccess for already-authenticated client", () => {
        const { svc } = createService();
        svc.pinEnabled = false;
        const ws = createMockWs();
        svc.authenticatedClients.add(ws as any);

        svc.handleAuth(
            ws as any,
            "1.2.3.4",
            undefined,
            undefined,
            GET_STATE,
            false,
        );

        expect(ws._sent).toHaveLength(0);
    });
});

// ─── handleAuth — PIN auth ───────────────────────────────────

describe("handleAuth — PIN auth", () => {
    it("authenticates with correct PIN and returns session token", () => {
        const { svc } = createService("654321");
        const ws = createMockWs();

        svc.handleAuth(ws as any, "10.0.0.1", "654321", undefined, GET_STATE, true);

        expect(svc.authenticatedClients.has(ws as any)).toBe(true);
        const msgs = ws._parsed();
        expect(msgs).toHaveLength(1);
        expect(msgs[0].type).toBe("authSuccess");
        expect(msgs[0].sessionToken).toBeDefined();
        expect(msgs[0].sessionToken).toMatch(/^[a-f0-9]{64}$/);
    });

    it("rejects wrong PIN and tracks failed attempt", () => {
        const { svc } = createService("123456");
        const ws = createMockWs();

        svc.handleAuth(ws as any, "10.0.0.1", "000000", undefined, GET_STATE, true);

        expect(svc.authenticatedClients.has(ws as any)).toBe(false);
        const msgs = ws._parsed();
        expect(msgs).toHaveLength(1);
        expect(msgs[0].type).toBe("authFailed");
        expect(msgs[0].message).toContain("Wrong PIN");
        expect(msgs[0].message).toContain("4 attempts left");
    });

    it("locks out after 5 consecutive failed attempts", () => {
        const { svc } = createService("123456");
        const ip = "10.0.0.99";

        for (let i = 0; i < 5; i++) {
            const ws = createMockWs();
            svc.handleAuth(ws as any, ip, "wrong!", undefined, GET_STATE, true);
        }

        // 6th attempt should show lockout
        const ws = createMockWs();
        svc.handleAuth(ws as any, ip, "123456", undefined, GET_STATE, true);
        const msgs = ws._parsed();
        expect(msgs[0].type).toBe("authFailed");
        expect(msgs[0].message).toContain("Locked");
    });

    it("calls onAuthFailure callback on failed attempts", () => {
        const { svc } = createService("123456");
        const failureCb = vi.fn();
        svc.onAuthFailure = failureCb;
        const ws = createMockWs();

        svc.handleAuth(ws as any, "10.0.0.5", "wrong", undefined, GET_STATE, true);

        expect(failureCb).toHaveBeenCalledWith("10.0.0.5", 1, false);
    });

    it("sends error when getState throws", () => {
        const { svc } = createService();
        svc.pinEnabled = false;
        const ws = createMockWs();
        const badGetState = () => {
            throw new Error("state failure");
        };

        svc.handleAuth(
            ws as any,
            "10.0.0.1",
            undefined,
            undefined,
            badGetState,
            true,
        );

        const msgs = ws._parsed();
        expect(msgs).toHaveLength(1);
        expect(msgs[0].type).toBe("error");
    });
});

// ─── handleAuth — session token auth ─────────────────────────

describe("handleAuth — session token auth", () => {
    it("authenticates with valid session token and rotates it", () => {
        const { svc } = createService("123456");
        const ip = "10.0.0.1";

        // First: authenticate with PIN to get a session token
        const ws1 = createMockWs();
        svc.handleAuth(ws1 as any, ip, "123456", undefined, GET_STATE, true);
        const token1 = ws1._parsed()[0].sessionToken;
        expect(token1).toMatch(/^[a-f0-9]{64}$/);

        // Clean up first ws from authenticated set
        svc.removeClient(ws1 as any);

        // Second: reconnect with session token
        const ws2 = createMockWs();
        svc.handleAuth(ws2 as any, ip, undefined, token1, GET_STATE, true);
        const msgs = ws2._parsed();
        expect(msgs).toHaveLength(1);
        expect(msgs[0].type).toBe("authSuccess");
        // Token should be rotated
        expect(msgs[0].sessionToken).toBeDefined();
        expect(msgs[0].sessionToken).not.toBe(token1);
    });

    it("rejects session token from different IP", () => {
        const { svc } = createService("123456");

        // Authenticate from IP A
        const ws1 = createMockWs();
        svc.handleAuth(
            ws1 as any,
            "10.0.0.1",
            "123456",
            undefined,
            GET_STATE,
            true,
        );
        const token = ws1._parsed()[0].sessionToken;

        // Try to use token from IP B — should fall through to PIN auth and fail
        const ws2 = createMockWs();
        svc.handleAuth(ws2 as any, "10.0.0.2", undefined, token, GET_STATE, true);
        const msgs = ws2._parsed();
        expect(msgs[0].type).toBe("authFailed");
    });

    it("rejects malformed session token and falls through to PIN auth", () => {
        const { svc } = createService("123456");
        const ws = createMockWs();

        svc.handleAuth(
            ws as any,
            "10.0.0.1",
            undefined,
            "not-valid-hex",
            GET_STATE,
            true,
        );

        const msgs = ws._parsed();
        expect(msgs[0].type).toBe("authFailed");
        expect(msgs[0].message).toContain("Wrong PIN");
    });
});

// ─── verifyHttpAuth ──────────────────────────────────────────

describe("verifyHttpAuth", () => {
    function createMockReq(
        headerPin?: string,
        ip = "10.0.0.1",
    ): import("http").IncomingMessage {
        return {
            headers: headerPin ? { "x-tasksync-pin": headerPin } : {},
            socket: { remoteAddress: ip },
        } as any;
    }

    it("allows all requests when PIN is disabled", () => {
        const { svc } = createService();
        svc.pinEnabled = false;
        const req = createMockReq();
        const url = new URL("http://localhost/api/test");

        expect(svc.verifyHttpAuth(req, url)).toEqual({ allowed: true });
    });

    it("allows requests with correct PIN header", () => {
        const { svc } = createService("654321");
        const req = createMockReq("654321");
        const url = new URL("http://localhost/api/test");

        expect(svc.verifyHttpAuth(req, url)).toEqual({ allowed: true });
    });

    it("rejects requests with wrong PIN header", () => {
        const { svc } = createService("654321");
        const req = createMockReq("000000");
        const url = new URL("http://localhost/api/test");

        const result = svc.verifyHttpAuth(req, url);
        expect(result.allowed).toBe(false);
    });

    it("rejects requests with no PIN", () => {
        const { svc } = createService("654321");
        const req = createMockReq();
        const url = new URL("http://localhost/api/test");

        const result = svc.verifyHttpAuth(req, url);
        expect(result.allowed).toBe(false);
    });

    it("accepts PIN via query string", () => {
        const { svc } = createService("654321");
        const req = createMockReq();
        const url = new URL("http://localhost/api/test?pin=654321");

        const result = svc.verifyHttpAuth(req, url);
        expect(result.allowed).toBe(true);
    });

    it("locks out after repeated failures", () => {
        const { svc } = createService("654321");
        const url = new URL("http://localhost/api/test");

        for (let i = 0; i < 5; i++) {
            const req = createMockReq("wrong", "10.0.0.50");
            svc.verifyHttpAuth(req, url);
        }

        const req = createMockReq("654321", "10.0.0.50");
        const result = svc.verifyHttpAuth(req, url);
        expect(result.allowed).toBe(false);
        expect(result.lockedOut).toBe(true);
    });
});

// ─── getOrCreatePin ──────────────────────────────────────────

describe("getOrCreatePin", () => {
    it("generates a 6-digit PIN when none exists", () => {
        const ctx = createMockContext();
        const svc = new RemoteAuthService(ctx);

        const pin = svc.getOrCreatePin();
        expect(pin).toMatch(/^\d{6}$/);
    });

    it("returns persisted PIN from globalState", () => {
        const ctx = createMockContext();
        ctx.globalState.update("remotePin", "987654");
        const svc = new RemoteAuthService(ctx);

        expect(svc.getOrCreatePin()).toBe("987654");
    });

    it("upgrades short PINs to 6 digits", () => {
        const ctx = createMockContext();
        ctx.globalState.update("remotePin", "1234");
        const svc = new RemoteAuthService(ctx);

        const pin = svc.getOrCreatePin();
        expect(pin).toMatch(/^\d{6}$/);
        expect(pin).not.toBe("1234");
    });
});

// ─── cleanup / removeClient / clearSessionTokens ────────────

describe("lifecycle methods", () => {
    it("removeClient removes from authenticated set", () => {
        const { svc } = createService();
        const ws = createMockWs();
        svc.authenticatedClients.add(ws as any);

        svc.removeClient(ws as any);
        expect(svc.authenticatedClients.has(ws as any)).toBe(false);
    });

    it("clearSessionTokens clears all tokens", () => {
        const { svc } = createService("123456");
        const ws = createMockWs();
        svc.handleAuth(ws as any, "10.0.0.1", "123456", undefined, GET_STATE, true);

        svc.clearSessionTokens();

        // Token from earlier auth should no longer work
        const token = ws._parsed()[0].sessionToken;
        const ws2 = createMockWs();
        svc.handleAuth(ws2 as any, "10.0.0.1", undefined, token, GET_STATE, true);
        expect(ws2._parsed()[0].type).toBe("authFailed");
    });

    it("cleanup clears all state", () => {
        const { svc } = createService();
        const ws = createMockWs();
        svc.authenticatedClients.add(ws as any);

        svc.cleanup();

        expect(svc.authenticatedClients.size).toBe(0);
    });

    it("startFailedAttemptsCleanup does not throw when called twice", () => {
        const { svc } = createService();
        svc.startFailedAttemptsCleanup();
        svc.startFailedAttemptsCleanup();
        svc.cleanup(); // clean up timer
    });
});
