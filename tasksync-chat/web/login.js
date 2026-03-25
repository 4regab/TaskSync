// ==================== Login Page Script ====================
// Handles PIN input, WebSocket auth, and session management for login page.

const LOGIN_CONNECT_TIMEOUT_MS = 10000; // WebSocket connection timeout
const SESSION_KEYS = TASKSYNC_SESSION_KEYS; // Reference shared SSOT constant
const getWsProtocol = getTaskSyncWsProtocol; // Reference shared SSOT helper

// Register service worker for PWA support (caching, offline, install)
if ("serviceWorker" in navigator) {
    navigator.serviceWorker
        .register("./sw.js")
        .then((reg) => {
            reg.addEventListener("updatefound", () => {
                const nw = reg.installing;
                if (nw)
                    nw.addEventListener("statechange", () => {
                        if (
                            nw.state === "activated" &&
                            navigator.serviceWorker.controller
                        ) {
                            // New service worker activated — user will get update on next reload
                        }
                    });
            });
        })
        .catch((err) => console.error("[TaskSync] SW registration failed:", err));
}

const digits = document.querySelectorAll(".pin-digit");
const submitBtn = document.getElementById("submit");
const errorEl = document.getElementById("error");
const connectingEl = document.getElementById("connecting");

let ws = null;

/** Check protocol version; warn if mismatched */
function checkProtocolVersion(msg) {
    if (
        msg.protocolVersion !== undefined &&
        msg.protocolVersion !== TASKSYNC_PROTOCOL_VERSION
    ) {
        console.error(
            "[TaskSync] Protocol version mismatch: server=" +
            msg.protocolVersion +
            " client=" +
            TASKSYNC_PROTOCOL_VERSION,
        );
    }
}

// Handle successful auth (SSOT)
function handleAuthSuccess(state, pin, sessionToken) {
    sessionStorage.setItem(SESSION_KEYS.STATE, JSON.stringify(state));
    sessionStorage.setItem(SESSION_KEYS.CONNECTED, "true");
    if (sessionToken) {
        sessionStorage.setItem(SESSION_KEYS.SESSION_TOKEN, sessionToken);
        sessionStorage.removeItem(SESSION_KEYS.PIN);
    } else if (pin) {
        sessionStorage.setItem(SESSION_KEYS.PIN, pin);
    }
    window.location.href = "app.html";
}

// Auto-focus first digit (if visible)
digits[0]?.focus();

// Handle digit input
digits.forEach((input, i) => {
    input.addEventListener("input", (e) => {
        const value = e.target.value.replace(/\D/g, "");
        e.target.value = value.slice(-1);

        if (value && i < digits.length - 1) {
            digits[i + 1].focus();
        }

        updateSubmitState();
        clearError();
    });

    input.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" && !e.target.value && i > 0) {
            digits[i - 1].focus();
        }
        if (e.key === "Enter") {
            attemptConnect();
        }
    });

    input.addEventListener("paste", (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData.getData("text") || "")
            .replace(/\D/g, "")
            .slice(0, 6);
        pasted.split("").forEach((char, j) => {
            if (digits[j]) digits[j].value = char;
        });
        if (pasted.length > 0) {
            digits[Math.min(pasted.length, digits.length - 1)].focus();
        }
        updateSubmitState();
    });
});

function updateSubmitState() {
    const pin = getPin();
    submitBtn.disabled = pin.length < 4;

    // Reveal extra PIN digit inputs as needed
    const extras = document.querySelectorAll(".pin-digit-extra");
    extras.forEach((el, j) => {
        const threshold = 4 + j; // 5th digit needs 4 filled, 6th needs 5 filled
        el.classList.toggle("active", pin.length >= threshold);
    });
}

function getPin() {
    return Array.from(digits)
        .map((d) => d.value)
        .join("");
}

function setError(msg) {
    errorEl.textContent = msg;
    digits.forEach((d) => d.classList.add("error"));
    setTimeout(() => digits.forEach((d) => d.classList.remove("error")), 300);
}

function clearError() {
    errorEl.textContent = "";
}

function setConnecting(loading) {
    connectingEl.classList.toggle("visible", loading);
    if (loading) {
        submitBtn.disabled = true;
    } else {
        updateSubmitState();
    }
}

submitBtn.addEventListener("click", attemptConnect);

function attemptConnect() {
    const pin = getPin();
    if (pin.length < 4) return;

    // Close any previous connection
    if (ws) {
        try {
            ws.close();
        } catch { }
        ws = null;
    }

    setConnecting(true);
    clearError();

    // Connection timeout — don't leave user stuck forever
    const connectTimeout = setTimeout(() => {
        if (ws && ws.readyState !== WebSocket.OPEN) {
            try {
                ws.close();
            } catch { }
            setConnecting(false);
            setError("Connection timed out");
        }
    }, LOGIN_CONNECT_TIMEOUT_MS);

    // Connect WebSocket
    ws = new WebSocket(`${getWsProtocol()}//${location.host}`);

    ws.onopen = () => {
        clearTimeout(connectTimeout);
        ws.send(JSON.stringify({ type: "auth", pin }));
    };

    ws.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            checkProtocolVersion(msg);

            if (msg.type === "authSuccess") {
                // Close login WebSocket before redirect to free MAX_CLIENTS slot
                ws.close();
                // Store state, PIN and session token, then redirect to app
                handleAuthSuccess(msg.state, pin, msg.sessionToken);
            } else if (msg.type === "authFailed") {
                setConnecting(false);
                setError(msg.message || "Invalid PIN");
                digits.forEach((d) => (d.value = ""));
                digits[0].focus();
                updateSubmitState();
            } else if (msg.type === "connected") {
                // No PIN required
                ws.close();
                handleAuthSuccess(msg.state, null, null);
            } else if (msg.type === "error") {
                // Server error during auth
                setConnecting(false);
                setError(msg.message || "Server error");
            }
            // Ignore 'requireAuth' — we already sent PIN, waiting for auth response
        } catch {
            setConnecting(false);
            setError("Connection error");
        }
    };

    ws.onerror = () => {
        clearTimeout(connectTimeout);
        setConnecting(false);
        setError("Connection failed");
    };

    ws.onclose = () => {
        clearTimeout(connectTimeout);
        if (connectingEl.classList.contains("visible")) {
            setConnecting(false);
            setError("Connection closed");
        }
    };
}

// Check for OTP in the URL path (/XXXX).
// Clear OTP from URL immediately after reading to minimize exposure.
const pathOtp = window.location.pathname.split("/").filter(Boolean).pop();
const urlPin = pathOtp && /^\d{4,6}$/.test(pathOtp) ? pathOtp : "";
if (urlPin && urlPin.length >= 4) {
    // Clear OTP from URL
    window.history.replaceState({}, "", "/");
    // Fill PIN inputs with URL PIN
    const pinDigits = urlPin.slice(0, 6).split("");
    pinDigits.forEach((char, i) => {
        if (digits[i]) digits[i].value = char;
    });
    updateSubmitState();
    // Auto-authenticate
    attemptConnect();
} else {
    // Try connecting to check if PIN is required, or auto-login with stored credentials
    (function checkAuth() {
        const sessionToken =
            sessionStorage.getItem(SESSION_KEYS.SESSION_TOKEN) || "";
        const storedPin = sessionStorage.getItem(SESSION_KEYS.PIN) || "";
        const hasCredentials = !!(sessionToken || storedPin);

        const checkWs = new WebSocket(`${getWsProtocol()}//${location.host}`);

        // Timeout for auto-check
        const checkTimeout = setTimeout(() => {
            try {
                checkWs.close();
            } catch { }
        }, LOGIN_CONNECT_TIMEOUT_MS);

        if (hasCredentials) {
            checkWs.onopen = () => {
                checkWs.send(
                    JSON.stringify({
                        type: "auth",
                        pin: storedPin,
                        sessionToken: sessionToken,
                    }),
                );
            };
        }

        checkWs.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                checkProtocolVersion(msg);
                if (msg.type === "connected") {
                    // No PIN required, go to app
                    clearTimeout(checkTimeout);
                    handleAuthSuccess(msg.state, null, null);
                    checkWs.close();
                    return;
                }
                if (msg.type === "authSuccess") {
                    // Stored credentials worked — auto-login
                    clearTimeout(checkTimeout);
                    handleAuthSuccess(msg.state, storedPin || null, msg.sessionToken);
                    checkWs.close();
                    return;
                }
                if (msg.type === "authFailed" || msg.type === "error") {
                    // Stored credentials invalid — clear and show PIN input
                    clearTimeout(checkTimeout);
                    sessionStorage.removeItem(SESSION_KEYS.SESSION_TOKEN);
                    sessionStorage.removeItem(SESSION_KEYS.PIN);
                    checkWs.close();
                    return;
                }
                if (msg.type === "requireAuth" && !hasCredentials) {
                    // No stored credentials — PIN input already visible
                    clearTimeout(checkTimeout);
                    checkWs.close();
                    return;
                }
                // If requireAuth and hasCredentials, wait for auth response
            } catch {
                clearTimeout(checkTimeout);
                checkWs.close();
            }
        };

        checkWs.onerror = () => {
            clearTimeout(checkTimeout);
            checkWs.close();
        };
    })();
}
