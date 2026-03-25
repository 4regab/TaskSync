import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteAuthService } from "./remoteAuthService";

function createMockContext() {
    return {
        globalState: {
            get: (_key: string) => undefined,
            update: (_key: string, _value: unknown) => Promise.resolve(),
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

function createService() {
    const svc = new RemoteAuthService(createMockContext());
    svc.pinEnabled = true;
    return svc;
}

function differentCode(validCode: string): string {
    return validCode === "000000" ? "000001" : "000000";
}

const DUMMY_STATE = { pending: null, queue: [] };
const GET_STATE = () => DUMMY_STATE;

afterEach(() => {
    vi.useRealTimers();
});

describe("normalizeIp", () => {
    it("strips IPv6-mapped IPv4 prefix", () => {
        const svc = createService();
        expect(svc.normalizeIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
    });

    it("passes through plain IPv4", () => {
        const svc = createService();
        expect(svc.normalizeIp("192.168.1.1")).toBe("192.168.1.1");
    });

    it("passes through IPv6", () => {
        const svc = createService();
        expect(svc.normalizeIp("::1")).toBe("::1");
    });
});

describe("handleAuth - no-PIN mode", () => {
    it("authenticates and sends authSuccess when client not yet authenticated", () => {
        const svc = createService();
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
        const svc = createService();
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

describe("handleAuth - OTP auth", () => {
    it("authenticates with correct OTP and returns session token", () => {
        const svc = createService();
        const ws = createMockWs();
        const otp = svc.getCurrentOtp();

        svc.handleAuth(ws as any, "10.0.0.1", otp, undefined, GET_STATE, true);

        expect(svc.authenticatedClients.has(ws as any)).toBe(true);
        const msgs = ws._parsed();
        expect(msgs).toHaveLength(1);
        expect(msgs[0].type).toBe("authSuccess");
        expect(msgs[0].sessionToken).toBeDefined();
        expect(msgs[0].sessionToken).toMatch(/^[a-f0-9]{64}$/);
    });

    it("rejects wrong code and tracks failed attempt", () => {
        const svc = createService();
        const ws = createMockWs();
        const wrongOtp = differentCode(svc.getCurrentOtp());

        svc.handleAuth(ws as any, "10.0.0.1", wrongOtp, undefined, GET_STATE, true);

        expect(svc.authenticatedClients.has(ws as any)).toBe(false);
        const msgs = ws._parsed();
        expect(msgs).toHaveLength(1);
        expect(msgs[0].type).toBe("authFailed");
        expect(msgs[0].message).toContain("Wrong code");
        expect(msgs[0].message).toContain("4 attempts left");
    });

    it("accepts previous-step OTP within tolerance window", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

        const svc = createService();
        const previousStepOtp = svc.getCurrentOtp();
        vi.setSystemTime(new Date("2026-01-01T00:00:31.000Z"));

        const ws = createMockWs();
        svc.handleAuth(
            ws as any,
            "10.0.0.1",
            previousStepOtp,
            undefined,
            GET_STATE,
            true,
        );

        expect(ws._parsed()[0].type).toBe("authSuccess");
    });

    it("rejects stale OTP outside tolerance window", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

        const svc = createService();
        const staleOtp = svc.getCurrentOtp();
        vi.setSystemTime(new Date("2026-01-01T00:01:31.000Z"));

        const ws = createMockWs();
        svc.handleAuth(
            ws as any,
            "10.0.0.1",
            staleOtp,
            undefined,
            GET_STATE,
            true,
        );

        expect(ws._parsed()[0].type).toBe("authFailed");
    });

    it("locks out after 5 consecutive failed attempts", () => {
        const svc = createService();
        const ip = "10.0.0.99";
        const wrongOtp = differentCode(svc.getCurrentOtp());

        for (let i = 0; i < 5; i++) {
            const ws = createMockWs();
            svc.handleAuth(ws as any, ip, wrongOtp, undefined, GET_STATE, true);
        }

        const validOtp = svc.getCurrentOtp();
        const ws = createMockWs();
        svc.handleAuth(ws as any, ip, validOtp, undefined, GET_STATE, true);
        const msgs = ws._parsed();
        expect(msgs[0].type).toBe("authFailed");
        expect(msgs[0].message).toContain("Locked");
    });

    it("calls onAuthFailure callback on failed attempts", () => {
        const svc = createService();
        const failureCb = vi.fn();
        svc.onAuthFailure = failureCb;
        const ws = createMockWs();
        const wrongOtp = differentCode(svc.getCurrentOtp());

        svc.handleAuth(ws as any, "10.0.0.5", wrongOtp, undefined, GET_STATE, true);

        expect(failureCb).toHaveBeenCalledWith("10.0.0.5", 1, false);
    });

    it("sends error when getState throws", () => {
        const svc = createService();
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

describe("handleAuth - session token auth", () => {
    it("authenticates with valid session token and rotates it", () => {
        const svc = createService();
        const ip = "10.0.0.1";
        const otp = svc.getCurrentOtp();

        const ws1 = createMockWs();
        svc.handleAuth(ws1 as any, ip, otp, undefined, GET_STATE, true);
        const token1 = ws1._parsed()[0].sessionToken;
        expect(token1).toMatch(/^[a-f0-9]{64}$/);

        svc.removeClient(ws1 as any);

        const ws2 = createMockWs();
        svc.handleAuth(ws2 as any, ip, undefined, token1, GET_STATE, true);
        const msgs = ws2._parsed();
        expect(msgs).toHaveLength(1);
        expect(msgs[0].type).toBe("authSuccess");
        expect(msgs[0].sessionToken).toBeDefined();
        expect(msgs[0].sessionToken).not.toBe(token1);
    });

    it("rejects session token from different IP", () => {
        const svc = createService();

        const ws1 = createMockWs();
        svc.handleAuth(
            ws1 as any,
            "10.0.0.1",
            svc.getCurrentOtp(),
            undefined,
            GET_STATE,
            true,
        );
        const token = ws1._parsed()[0].sessionToken;

        const ws2 = createMockWs();
        svc.handleAuth(ws2 as any, "10.0.0.2", undefined, token, GET_STATE, true);
        const msgs = ws2._parsed();
        expect(msgs[0].type).toBe("authFailed");
    });

    it("rejects malformed session token and falls through to code auth", () => {
        const svc = createService();
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
        expect(msgs[0].message).toContain("Wrong code");
    });
});

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

    it("allows all requests when auth code is disabled", () => {
        const svc = createService();
        svc.pinEnabled = false;
        const req = createMockReq();
        const url = new URL("http://localhost/api/test");

        expect(svc.verifyHttpAuth(req, url)).toEqual({ allowed: true });
    });

    it("allows requests with correct code in header", () => {
        const svc = createService();
        const req = createMockReq(svc.getCurrentOtp());
        const url = new URL("http://localhost/api/test");

        expect(svc.verifyHttpAuth(req, url)).toEqual({ allowed: true });
    });

    it("rejects requests with wrong code in header", () => {
        const svc = createService();
        const req = createMockReq(differentCode(svc.getCurrentOtp()));
        const url = new URL("http://localhost/api/test");

        const result = svc.verifyHttpAuth(req, url);
        expect(result.allowed).toBe(false);
    });

    it("rejects requests with no code", () => {
        const svc = createService();
        const req = createMockReq();
        const url = new URL("http://localhost/api/test");

        const result = svc.verifyHttpAuth(req, url);
        expect(result.allowed).toBe(false);
    });

    it("accepts code via query string", () => {
        const svc = createService();
        const req = createMockReq();
        const url = new URL(`http://localhost/api/test?pin=${svc.getCurrentOtp()}`);

        const result = svc.verifyHttpAuth(req, url);
        expect(result.allowed).toBe(true);
    });

    it("locks out after repeated failures", () => {
        const svc = createService();
        const url = new URL("http://localhost/api/test");
        const wrong = differentCode(svc.getCurrentOtp());

        for (let i = 0; i < 5; i++) {
            const req = createMockReq(wrong, "10.0.0.50");
            svc.verifyHttpAuth(req, url);
        }

        const req = createMockReq(svc.getCurrentOtp(), "10.0.0.50");
        const result = svc.verifyHttpAuth(req, url);
        expect(result.allowed).toBe(false);
        expect(result.lockedOut).toBe(true);
    });
});

describe("getCurrentOtp", () => {
    it("returns a 6-digit code", () => {
        const svc = createService();
        expect(svc.getCurrentOtp()).toMatch(/^\d{6}$/);
    });

    it("returns stable code within the same time window", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
        const svc = createService();

        const code1 = svc.getCurrentOtp();
        const code2 = svc.getCurrentOtp();
        expect(code1).toBe(code2);
    });
});

describe("lifecycle methods", () => {
    it("removeClient removes from authenticated set", () => {
        const svc = createService();
        const ws = createMockWs();
        svc.authenticatedClients.add(ws as any);

        svc.removeClient(ws as any);
        expect(svc.authenticatedClients.has(ws as any)).toBe(false);
    });

    it("clearSessionTokens clears all tokens", () => {
        const svc = createService();
        const ws = createMockWs();
        svc.handleAuth(
            ws as any,
            "10.0.0.1",
            svc.getCurrentOtp(),
            undefined,
            GET_STATE,
            true,
        );

        svc.clearSessionTokens();

        const token = ws._parsed()[0].sessionToken;
        const ws2 = createMockWs();
        svc.handleAuth(ws2 as any, "10.0.0.1", undefined, token, GET_STATE, true);
        expect(ws2._parsed()[0].type).toBe("authFailed");
    });

    it("cleanup clears all state", () => {
        const svc = createService();
        const ws = createMockWs();
        svc.authenticatedClients.add(ws as any);

        svc.cleanup();

        expect(svc.authenticatedClients.size).toBe(0);
    });

    it("startFailedAttemptsCleanup does not throw when called twice", () => {
        const svc = createService();
        svc.startFailedAttemptsCleanup();
        svc.startFailedAttemptsCleanup();
        svc.cleanup();
    });
});
