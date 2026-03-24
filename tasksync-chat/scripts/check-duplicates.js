/**
 * Scans TypeScript source files for consecutive duplicate code blocks.
 *
 * Catches corruption from multi-line replacement tools (e.g. the triple
 * notifyQueueChanged bug) by detecting 3+ identical consecutive lines
 * in the same file.
 *
 * Usage: node scripts/check-duplicates.js
 * Exit code 0 = clean, 1 = duplicates found
 */

const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.join(__dirname, "..", "src");
const MIN_CONSECUTIVE = 3; // Flag when 3+ identical lines repeat consecutively
const EXTENSIONS = [".ts", ".js"];
const IGNORE_PATTERNS = [
    /^\s*$/, // Empty lines
    /^\s*\/\//, // Single-line comments
    /^\s*\*/, // JSDoc / block comment lines
    /^\s*[{}]\s*$/, // Lone braces
    /^\s*import\s/, // Import lines
];

function shouldIgnoreLine(line) {
    return IGNORE_PATTERNS.some((pattern) => pattern.test(line));
}

function scanFile(filePath) {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const issues = [];

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];

        if (shouldIgnoreLine(line)) {
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
                count,
                text: line.trim().slice(0, 80),
            });
        }

        // Also check for repeated multi-line blocks (2-5 line patterns)
        for (let blockSize = 2; blockSize <= 5; blockSize++) {
            if (i + blockSize * 2 > lines.length) break;

            const block = lines.slice(i, i + blockSize).join("\n");
            // Skip if block is all ignorable
            if (lines.slice(i, i + blockSize).every(shouldIgnoreLine)) break;

            let blockCount = 1;
            let offset = blockSize;
            while (i + offset + blockSize <= lines.length) {
                const nextBlock = lines.slice(i + offset, i + offset + blockSize).join("\n");
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
                    count: blockCount,
                    text: `[${blockSize}-line block] ${lines[i].trim().slice(0, 60)}...`,
                });
            }
        }

        i++;
    }

    return issues;
}

function walkDir(dir) {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name === "__mocks__") continue;
            results.push(...walkDir(fullPath));
        } else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
            results.push(fullPath);
        }
    }
    return results;
}

// ── Main ──

const files = walkDir(SRC_DIR);
let hasIssues = false;

for (const file of files) {
    const issues = scanFile(file);
    if (issues.length > 0) {
        hasIssues = true;
        const relPath = path.relative(path.join(__dirname, ".."), file);
        for (const issue of issues) {
            console.error(
                `❌ ${relPath}:${issue.line} — ${issue.count}x consecutive duplicate: ${issue.text}`,
            );
        }
    }
}

if (hasIssues) {
    console.error("\n❌ Duplicate blocks detected! This may indicate tool corruption.");
    process.exit(1);
} else {
    console.log("✅ No duplicate blocks found.");
    process.exit(0);
}
