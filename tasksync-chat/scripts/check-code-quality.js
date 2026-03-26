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

// ── Checker registry ──
// To add a new check: add { name, check(filePath, content) => Issue[] } here.

const CHECKERS = [
    { name: "duplicate-blocks", check: checkDuplicates },
    { name: "sync-io", check: checkSyncIO },
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
