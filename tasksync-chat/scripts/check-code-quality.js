/**
 * Unified code quality scanner for TaskSync.
 *
 * Runs all custom static-analysis checks in a single pass over the source tree.
 * Adding a new check = adding a new checker object to CHECKERS below.
 * No package.json changes needed — `npm run check-code` runs everything.
 *
 * Current checks:
 *   1. Duplicate blocks — catches tool corruption (3+ identical consecutive lines/blocks)
 *   2. Sync I/O        — catches blocking fs calls (must use fs.promises.*)
 *   3. HTML-JS ID sync — ensures getElementById() calls reference IDs that exist in HTML templates
 *   4. Constants sync  — ensures webview-ui fallback values match remoteConstants.ts SSOT
 *
 * Usage: node scripts/check-code-quality.js
 * Exit code 0 = clean, 1 = violations found
 */

const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.join(__dirname, "..", "src");
const IGNORE_DIRS = ["node_modules", "__mocks__"];
const FILE_EXTENSIONS = [".ts", ".js"];

// ── Shared utilities ──

function walkDir(dir) {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (IGNORE_DIRS.includes(entry.name)) continue;
            results.push(...walkDir(fullPath));
        } else if (FILE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
            results.push(fullPath);
        }
    }
    return results;
}

function relPath(filePath) {
    return path.relative(path.join(__dirname, ".."), filePath);
}

// ── Check 1: Duplicate blocks ──

const DUPLICATE_IGNORE_PATTERNS = [
    /^\s*$/, // Empty lines
    /^\s*\/\//, // Single-line comments
    /^\s*\*/, // JSDoc / block comment lines
    /^\s*[{}]\s*$/, // Lone braces
    /^\s*import\s/, // Import lines
];

function shouldIgnoreDupLine(line) {
    return DUPLICATE_IGNORE_PATTERNS.some((p) => p.test(line));
}

const MIN_CONSECUTIVE = 3;

function checkDuplicates(filePath, content) {
    const lines = content.split("\n");
    const issues = [];

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];

        if (shouldIgnoreDupLine(line)) {
            i++;
            continue;
        }

        // Count consecutive identical lines
        let count = 1;
        while (i + count < lines.length && lines[i + count] === line) {
            count++;
        }

        if (count >= MIN_CONSECUTIVE) {
            issues.push({
                line: i + 1,
                text: `${count}x consecutive duplicate: ${line.trim().slice(0, 80)}`,
            });
        }

        // Check for repeated multi-line blocks (2-5 line patterns)
        for (let blockSize = 2; blockSize <= 5; blockSize++) {
            if (i + blockSize * 2 > lines.length) break;

            const block = lines.slice(i, i + blockSize).join("\n");
            if (lines.slice(i, i + blockSize).every(shouldIgnoreDupLine)) break;

            let blockCount = 1;
            let offset = blockSize;
            while (i + offset + blockSize <= lines.length) {
                const nextBlock = lines
                    .slice(i + offset, i + offset + blockSize)
                    .join("\n");
                if (nextBlock === block) {
                    blockCount++;
                    offset += blockSize;
                } else {
                    break;
                }
            }

            if (blockCount >= MIN_CONSECUTIVE) {
                issues.push({
                    line: i + 1,
                    text: `${blockCount}x repeated [${blockSize}-line block]: ${lines[i].trim().slice(0, 60)}...`,
                });
            }
        }

        i++;
    }

    return issues;
}

// ── Check 2: Sync I/O ──

const SYNC_IO_PATTERNS = [
    /\bfs\.existsSync\b/,
    /\bfs\.statSync\b/,
    /\bfs\.lstatSync\b/,
    /\bfs\.readFileSync\b/,
    /\bfs\.writeFileSync\b/,
    /\bfs\.mkdirSync\b/,
    /\bfs\.accessSync\b/,
    /\bfs\.readdirSync\b/,
    /\bfs\.unlinkSync\b/,
    /\bfs\.appendFileSync\b/,
    /\bfs\.renameSync\b/,
    /\bfs\.copyFileSync\b/,
    /\bfs\.chmodSync\b/,
    /\bfs\.rmdirSync\b/,
    /\bfs\.openSync\b/,
    /\bfs\.closeSync\b/,
    /\bfs\.readSync\b/,
    /\bfs\.writeSync\b/,
];

const SYNC_IO_ALLOW_COMMENT = "sync-io-allowed";

function checkSyncIO(filePath, content) {
    // Skip test files
    if (filePath.endsWith(".test.ts")) return [];

    const lines = content.split("\n");
    const issues = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes(SYNC_IO_ALLOW_COMMENT)) continue;

        for (const pattern of SYNC_IO_PATTERNS) {
            if (pattern.test(line)) {
                issues.push({
                    line: i + 1,
                    text: `sync I/O (${pattern.source}): ${line.trim().slice(0, 100)}`,
                });
                break;
            }
        }
    }

    return issues;
}

// ── Check 3: HTML-JS ID sync ──
// Ensures every getElementById("x") in webview-ui JS references an ID that
// actually exists in an HTML template (webview-body.html, remoteHtmlService.ts,
// or dynamically-created HTML in JS files).

const HTML_TEMPLATE = path.join(__dirname, "..", "media", "webview-body.html");
const REMOTE_HTML_SERVICE = path.join(
    __dirname,
    "..",
    "src",
    "server",
    "remoteHtmlService.ts",
);
const WEBVIEW_UI_DIR = path.join(__dirname, "..", "src", "webview-ui");
const ID_SYNC_ALLOW_COMMENT = "ssot-id-allowed";

function extractHtmlIds(content) {
    const regex = /(?<!-)id="([^"]+)"/g;
    const ids = new Set();
    let match;
    while ((match = regex.exec(content)) !== null) {
        // Skip dynamic expressions (e.g. ' + variable + ')
        if (match[1].includes("'") || match[1].includes("+")) continue;
        ids.add(match[1]);
    }
    return ids;
}

function collectValidHtmlIds() {
    const ids = new Set();

    // 1. Static HTML template
    if (fs.existsSync(HTML_TEMPLATE)) {
        for (const id of extractHtmlIds(fs.readFileSync(HTML_TEMPLATE, "utf8"))) {
            ids.add(id);
        }
    }

    // 2. Remote-only wrapper elements
    if (fs.existsSync(REMOTE_HTML_SERVICE)) {
        for (const id of extractHtmlIds(
            fs.readFileSync(REMOTE_HTML_SERVICE, "utf8"),
        )) {
            ids.add(id);
        }
    }

    // 3. Dynamically created HTML in webview-ui JS files
    //    Covers both inline HTML strings (id="x") and property assignments (.id = "x")
    if (fs.existsSync(WEBVIEW_UI_DIR)) {
        for (const file of fs.readdirSync(WEBVIEW_UI_DIR)) {
            if (!file.endsWith(".js")) continue;
            const content = fs.readFileSync(
                path.join(WEBVIEW_UI_DIR, file),
                "utf8",
            );
            for (const id of extractHtmlIds(content)) {
                ids.add(id);
            }
            // Also capture .id = "x" property assignments (e.g. el.id = "choices-bar")
            const idAssignRegex = /\.id\s*=\s*"([^"]+)"/g;
            let m;
            while ((m = idAssignRegex.exec(content)) !== null) {
                ids.add(m[1]);
            }
        }
    }

    return ids;
}

const VALID_HTML_IDS = collectValidHtmlIds();

function checkHtmlJsIdSync(filePath, content) {
    // Only check webview-ui JS files
    if (!filePath.includes("webview-ui") || !filePath.endsWith(".js")) return [];

    const issues = [];
    const lines = content.split("\n");
    const regex = /getElementById\(\s*"([^"]+)"\s*\)/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
        const id = match[1];
        if (VALID_HTML_IDS.has(id)) continue;

        // Find line number
        const lineNum = content.slice(0, match.index).split("\n").length;

        // Check for suppression comment
        if (lines[lineNum - 1].includes(ID_SYNC_ALLOW_COMMENT)) continue;

        issues.push({
            line: lineNum,
            text: `getElementById("${id}") references an ID not found in any HTML template`,
        });
    }

    return issues;
}

// ── Check 4: Constants sync ──
// Ensures webview-ui fallback values (typeof TASKSYNC_* guards) match the SSOT
// in web/shared-constants.js (generated from remoteConstants.ts by esbuild).

const SHARED_CONSTANTS_PATH = path.join(
    __dirname,
    "..",
    "web",
    "shared-constants.js",
);

function collectSsotConstants() {
    if (!fs.existsSync(SHARED_CONSTANTS_PATH)) return null;
    const content = fs.readFileSync(SHARED_CONSTANTS_PATH, "utf8");

    const numerics = new Map();
    const numRegex = /var\s+(TASKSYNC_\w+)\s*=\s*(\d+)\s*;/g;
    let m;
    while ((m = numRegex.exec(content)) !== null) {
        numerics.set(m[1], parseInt(m[2], 10));
    }

    const arrays = new Map();
    const arrRegex = /var\s+(TASKSYNC_\w+)\s*=\s*\[([^\]]+)\]\s*;/g;
    while ((m = arrRegex.exec(content)) !== null) {
        const values = m[2]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .join(", ");
        arrays.set(m[1], values);
    }

    const strings = new Map();
    const strRegex = /var\s+(TASKSYNC_\w+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/g;
    while ((m = strRegex.exec(content)) !== null) {
        strings.set(m[1], m[2]);
    }

    return { numerics, arrays, strings };
}

const SSOT_CONSTANTS = collectSsotConstants();

function checkConstantsSync(filePath, content) {
    if (!SSOT_CONSTANTS) return [];
    if (!filePath.includes("webview-ui") || !filePath.endsWith(".js")) return [];

    const issues = [];
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
        const typeofMatch = lines[i].match(
            /typeof\s+(TASKSYNC_\w+)\s*!==\s*"undefined"/,
        );
        if (!typeofMatch) continue;

        const name = typeofMatch[1];

        // Scan forward (up to 10 lines) for the fallback value after ":"
        for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
            // Numeric fallback: `: NUMBER;` or `: NUMBER,`
            const numMatch = lines[j].match(/^\s*:\s*(\d+)\s*[;,]/);
            if (numMatch) {
                const fallback = parseInt(numMatch[1], 10);
                const ssot = SSOT_CONSTANTS.numerics.get(name);
                if (ssot !== undefined && ssot !== fallback) {
                    issues.push({
                        line: j + 1,
                        text: `${name} fallback (${fallback}) differs from SSOT (${ssot})`,
                    });
                }
                break;
            }

            // Array fallback: `: new Set([values])`
            if (/:\s*new Set\(\[/.test(lines[j])) {
                let arrContent = "";
                for (let k = j; k < lines.length; k++) {
                    arrContent += lines[k];
                    if (/\]\)\s*[;,]/.test(lines[k])) break;
                }
                const inner = arrContent.match(/new Set\(\[\s*([\d,\s]+)\s*\]\)/);
                if (inner) {
                    const fallbackValues = inner[1]
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                        .join(", ");
                    const ssot = SSOT_CONSTANTS.arrays.get(name);
                    if (ssot && ssot !== fallbackValues) {
                        issues.push({
                            line: j + 1,
                            text: `${name} fallback array differs from SSOT`,
                        });
                    }
                }
                break;
            }

            // String fallback: `: "value";`
            const strMatch = lines[j].match(
                /^\s*:\s*"((?:[^"\\]|\\.)*)"\s*[;,]/,
            );
            if (strMatch) {
                const fallback = strMatch[1];
                const ssot = SSOT_CONSTANTS.strings.get(name);
                if (ssot && ssot !== fallback) {
                    issues.push({
                        line: j + 1,
                        text: `${name} fallback string differs from SSOT`,
                    });
                }
                break;
            }
        }
    }

    return issues;
}

// ── Checker registry ──
// To add a new check: add { name, check(filePath, content) => Issue[] } here.

const CHECKERS = [
    { name: "duplicate-blocks", check: checkDuplicates },
    { name: "sync-io", check: checkSyncIO },
    { name: "html-js-id-sync", check: checkHtmlJsIdSync },
    { name: "constants-sync", check: checkConstantsSync },
];

// ── Main ──

const files = walkDir(SRC_DIR);
const allIssues = new Map(); // filePath → Issue[]

for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    for (const checker of CHECKERS) {
        const issues = checker.check(file, content);
        for (const issue of issues) {
            const key = relPath(file);
            if (!allIssues.has(key)) allIssues.set(key, []);
            allIssues.get(key).push({ ...issue, checker: checker.name });
        }
    }
}

let totalIssues = 0;
for (const [file, issues] of allIssues) {
    for (const issue of issues) {
        totalIssues++;
        console.error(
            `❌ ${file}:${issue.line} [${issue.checker}] ${issue.text}`,
        );
    }
}

if (totalIssues > 0) {
    console.error(
        `\n❌ ${totalIssues} code quality issue(s) found. Fix them or add an inline suppression comment if justified.`,
    );
    process.exit(1);
} else {
    console.log(
        `✅ All ${CHECKERS.length} code quality checks passed (${files.length} files scanned).`,
    );
    process.exit(0);
}
