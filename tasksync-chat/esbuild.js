const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const watch = process.argv.includes("--watch");

// ==================== Shared Constants Generation ====================
// Generates web/shared-constants.js from src/constants/remoteConstants.ts
// so that browser JS always stays in sync with the TypeScript SSOT.

function generateSharedConstants() {
    const source = fs.readFileSync(
        path.join(__dirname, "src", "constants", "remoteConstants.ts"),
        "utf8",
    );

    // Extract simple numeric constants: export const NAME = <number>;
    // NOTE: This regex only supports standalone integer literal assignments.
    // If a constant becomes an expression (e.g., 5 * 60 * 1000), extractNum()
    // will throw at build time — this is intentional and enforced by the regex.
    function extractNum(name) {
        const m = source.match(new RegExp(`export const ${name}\\s*=\\s*(\\d+)\\s*;`));
        if (!m)
            throw new Error(`Failed to extract ${name} from remoteConstants.ts`);
        return Number(m[1]);
    }

    // Extract response timeout array from Set<number>([...])
    const timeoutMatch = source.match(
        /RESPONSE_TIMEOUT_ALLOWED_VALUES\s*=\s*new Set<number>\(\[\s*([\d,\s]+)\s*\]\)/,
    );
    if (!timeoutMatch)
        throw new Error("Failed to extract RESPONSE_TIMEOUT_ALLOWED_VALUES");
    const timeoutValues = timeoutMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(", ");

    const v = {
        protocolVersion: extractNum("WS_PROTOCOL_VERSION"),
        timeoutDefault: extractNum("RESPONSE_TIMEOUT_DEFAULT_MINUTES"),
        sessionWarningDefault: extractNum("DEFAULT_SESSION_WARNING_HOURS"),
        sessionWarningMax: extractNum("SESSION_WARNING_HOURS_MAX"),
        maxAutoDefault: extractNum("DEFAULT_MAX_CONSECUTIVE_AUTO_RESPONSES"),
        maxAutoLimit: extractNum("MAX_CONSECUTIVE_AUTO_RESPONSES_LIMIT"),
        delayMinDefault: extractNum("DEFAULT_HUMAN_LIKE_DELAY_MIN"),
        delayMaxDefault: extractNum("DEFAULT_HUMAN_LIKE_DELAY_MAX"),
        delayMinLower: extractNum("HUMAN_DELAY_MIN_LOWER"),
        delayMinUpper: extractNum("HUMAN_DELAY_MIN_UPPER"),
        delayMaxLower: extractNum("HUMAN_DELAY_MAX_LOWER"),
        delayMaxUpper: extractNum("HUMAN_DELAY_MAX_UPPER"),
    };

    const output = `/**
 * AUTO-GENERATED from src/constants/remoteConstants.ts — DO NOT EDIT MANUALLY
 * Run \`node esbuild.js\` to regenerate.
 *
 * Shared constants for TaskSync web frontend (SSOT)
 * Used by both index.html (login page) and webview.js (app)
 * Include this file BEFORE index.html inline scripts or webview.js
 */

// Session storage keys
var TASKSYNC_SESSION_KEYS = {
    STATE: 'taskSyncState',
    PIN: 'taskSyncPin',
    CONNECTED: 'taskSyncConnected',
    SESSION_TOKEN: 'taskSyncSessionToken'
};

// WebSocket protocol helper
function getTaskSyncWsProtocol() {
    return location.protocol === 'https:' ? 'wss:' : 'ws:';
}

// Reconnection settings (build-script defaults, not from remoteConstants.ts — PWA-only)
var TASKSYNC_MAX_RECONNECT_ATTEMPTS = 20;
var TASKSYNC_MAX_RECONNECT_DELAY_MS = 30000;

// Protocol version (from WS_PROTOCOL_VERSION)
var TASKSYNC_PROTOCOL_VERSION = ${v.protocolVersion};

// Response timeout settings (from RESPONSE_TIMEOUT_ALLOWED_VALUES, RESPONSE_TIMEOUT_DEFAULT_MINUTES)
var TASKSYNC_RESPONSE_TIMEOUT_ALLOWED = [${timeoutValues}];
var TASKSYNC_RESPONSE_TIMEOUT_DEFAULT = ${v.timeoutDefault};

// Settings defaults & validation ranges (from remoteConstants.ts)
var TASKSYNC_DEFAULT_SESSION_WARNING_HOURS = ${v.sessionWarningDefault};
var TASKSYNC_SESSION_WARNING_HOURS_MAX = ${v.sessionWarningMax};
var TASKSYNC_DEFAULT_MAX_AUTO_RESPONSES = ${v.maxAutoDefault};
var TASKSYNC_MAX_AUTO_RESPONSES_LIMIT = ${v.maxAutoLimit};
var TASKSYNC_DEFAULT_HUMAN_LIKE_DELAY_MIN = ${v.delayMinDefault};
var TASKSYNC_DEFAULT_HUMAN_LIKE_DELAY_MAX = ${v.delayMaxDefault};
var TASKSYNC_HUMAN_DELAY_MIN_LOWER = ${v.delayMinLower};
var TASKSYNC_HUMAN_DELAY_MIN_UPPER = ${v.delayMinUpper};
var TASKSYNC_HUMAN_DELAY_MAX_LOWER = ${v.delayMaxLower};
var TASKSYNC_HUMAN_DELAY_MAX_UPPER = ${v.delayMaxUpper};
`;

    fs.writeFileSync(path.join(__dirname, "web", "shared-constants.js"), output);
}

// ==================== Webview Build (concatenation) ====================
// Webview source lives in src/webview-ui/ as separate files.
// They share a single IIFE closure scope, so we concatenate them
// in order and wrap with the IIFE boilerplate.

const WEBVIEW_SOURCE_DIR = path.join(__dirname, "src", "webview-ui");
const WEBVIEW_OUTPUT = path.join(__dirname, "media", "webview.js");

const WEBVIEW_FILES = [
    "constants.js",
    "adapter.js",
    "state.js",
    "init.js",
    "events.js",
    "history.js",
    "input.js",
    "messageHandler.js",
    "markdownUtils.js",
    "rendering.js",
    "queue.js",
    "approval.js",
    "settings.js",
    "slashCommands.js",
    "extras.js",
];

function buildWebview() {
    const header = [
        "/**",
        " * TaskSync Extension - Webview Script",
        " * Handles tool call history, prompt queue, attachments, and file autocomplete",
        " * ",
        " * Supports both VS Code webview (postMessage) and Remote PWA (WebSocket) modes",
        " * ",
        " * Built from src/webview-ui/ — DO NOT EDIT DIRECTLY",
        " */",
        "(function () {",
    ].join("\n");

    const footer = [
        "",
        "    if (document.readyState === 'loading') {",
        "        document.addEventListener('DOMContentLoaded', init);",
        "    } else {",
        "        init();",
        "    }",
        "}());",
        "",
    ].join("\n");

    let body = "";
    for (const file of WEBVIEW_FILES) {
        const content = fs.readFileSync(
            path.join(WEBVIEW_SOURCE_DIR, file),
            "utf8",
        );
        body += content;
        // Ensure each file ends with a newline for clean separation
        if (!content.endsWith("\n")) body += "\n";
    }

    fs.writeFileSync(WEBVIEW_OUTPUT, header + "\n" + body + footer);
}

function removeDistTestArtifacts() {
    const distDir = path.join(__dirname, "dist");
    if (!fs.existsSync(distDir)) {
        return;
    }

    const queue = [distDir];
    while (queue.length > 0) {
        const current = queue.pop();
        if (!current) continue;

        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(fullPath);
                continue;
            }

            if (/\.test\.js(\.map)?$/.test(entry.name)) {
                fs.unlinkSync(fullPath);
            }
        }
    }
}

// ==================== Main Build ====================

async function main() {
    // Prevent stale compiled test files from being discovered by non-Vitest runners.
    removeDistTestArtifacts();

    // Generate shared constants from SSOT (remoteConstants.ts → web/shared-constants.js)
    generateSharedConstants();
    console.log("Shared constants generated");

    // Build webview (concatenation, fast)
    buildWebview();
    console.log("Webview build complete");

    // Copy mermaid.min.js to media/ for local serving (no CDN dependency)
    fs.copyFileSync(
        path.join(__dirname, "node_modules", "mermaid", "dist", "mermaid.min.js"),
        path.join(__dirname, "media", "mermaid.min.js"),
    );
    console.log("Mermaid copied to media/");

    // Build extension (esbuild, TypeScript bundling)
    const ctx = await esbuild.context({
        entryPoints: ["src/extension.ts"],
        bundle: true,
        outfile: "dist/extension.js",
        external: ["vscode"],
        format: "cjs",
        platform: "node",
        target: "node18",
        sourcemap: true,
        minify: !watch,
        // Handle ESM packages with .js extensions
        mainFields: ["module", "main"],
        conditions: ["import", "node"],
        resolveExtensions: [".ts", ".js", ".mjs"],
    });

    if (watch) {
        await ctx.watch();
        console.log("Watching extension for changes...");

        // Also watch webview source files for changes
        const debounceTimers = {};
        for (const file of WEBVIEW_FILES) {
            const filePath = path.join(WEBVIEW_SOURCE_DIR, file);
            fs.watch(filePath, () => {
                // Debounce rebuilds (50ms)
                clearTimeout(debounceTimers[file]);
                debounceTimers[file] = setTimeout(() => {
                    try {
                        buildWebview();
                        console.log(`Webview rebuilt (${file} changed)`);
                    } catch (e) {
                        console.error("Webview build error:", e.message);
                    }
                }, 50);
            });
        }
        console.log("Watching webview source for changes...");

        // Watch shared constants SSOT so remote/PWA stays in sync during dev
        const remoteConstantsPath = path.join(
            __dirname,
            "src",
            "constants",
            "remoteConstants.ts",
        );
        let remoteConstantsTimer;
        fs.watch(remoteConstantsPath, () => {
            clearTimeout(remoteConstantsTimer);
            remoteConstantsTimer = setTimeout(() => {
                try {
                    generateSharedConstants();
                    console.log(
                        "Shared constants regenerated (remoteConstants.ts changed)",
                    );
                    buildWebview();
                    console.log("Webview rebuilt (shared constants changed)");
                } catch (e) {
                    console.error("Error regenerating shared constants:", e.message);
                }
            }, 100);
        });
        console.log("Watching shared constants for changes...");
    } else {
        await ctx.rebuild();
        await ctx.dispose();
        console.log("Build complete");
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
