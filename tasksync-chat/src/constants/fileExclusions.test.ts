import { describe, expect, it } from "vitest";
import {
	FILE_EXCLUSION_PATTERNS,
	FILE_SEARCH_EXCLUSION_PATTERNS,
	formatExcludePattern,
} from "../constants/fileExclusions";

describe("fileExclusions", () => {
	describe("FILE_EXCLUSION_PATTERNS", () => {
		it("is a non-empty array", () => {
			expect(FILE_EXCLUSION_PATTERNS.length).toBeGreaterThan(0);
		});

		it("contains standard exclusions", () => {
			expect(FILE_EXCLUSION_PATTERNS).toContain("**/node_modules/**");
			expect(FILE_EXCLUSION_PATTERNS).toContain("**/.git/**");
			expect(FILE_EXCLUSION_PATTERNS).toContain("**/dist/**");
			expect(FILE_EXCLUSION_PATTERNS).toContain("**/build/**");
		});

		it("all patterns are glob strings starting with **", () => {
			for (const pattern of FILE_EXCLUSION_PATTERNS) {
				expect(pattern).toMatch(/^\*\*\//);
			}
		});
	});

	describe("FILE_SEARCH_EXCLUSION_PATTERNS", () => {
		it("is a superset of FILE_EXCLUSION_PATTERNS", () => {
			for (const pattern of FILE_EXCLUSION_PATTERNS) {
				expect(FILE_SEARCH_EXCLUSION_PATTERNS).toContain(pattern);
			}
		});

		it("contains additional file-specific exclusions", () => {
			expect(FILE_SEARCH_EXCLUSION_PATTERNS).toContain("**/*.log");
			expect(FILE_SEARCH_EXCLUSION_PATTERNS).toContain("**/*.min.js");
			expect(FILE_SEARCH_EXCLUSION_PATTERNS).toContain("**/package-lock.json");
		});
	});

	describe("formatExcludePattern", () => {
		it("wraps patterns in curly braces", () => {
			const result = formatExcludePattern(["**/a/**", "**/b/**"]);
			expect(result).toBe("{**/a/**,**/b/**}");
		});

		it("handles single pattern", () => {
			const result = formatExcludePattern(["**/node_modules/**"]);
			expect(result).toBe("{**/node_modules/**}");
		});

		it("handles empty array", () => {
			expect(formatExcludePattern([])).toBe("{}");
		});

		it("produces valid pattern from actual constants", () => {
			const result = formatExcludePattern(FILE_EXCLUSION_PATTERNS);
			expect(result.startsWith("{")).toBe(true);
			expect(result.endsWith("}")).toBe(true);
			expect(result).toContain("**/node_modules/**");
		});
	});
});
