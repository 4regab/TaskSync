import { describe, expect, it } from "vitest";
import {
	RESPONSE_TIMEOUT_ALLOWED_VALUES,
	RESPONSE_TIMEOUT_DEFAULT_MINUTES,
} from "../constants/remoteConstants";
import { normalizeResponseTimeout } from "./settingsHandlers";

describe("normalizeResponseTimeout", () => {
	it("accepts valid allowed values", () => {
		for (const v of RESPONSE_TIMEOUT_ALLOWED_VALUES) {
			expect(normalizeResponseTimeout(v)).toBe(v);
		}
	});

	it("returns default for non-allowed numbers", () => {
		expect(normalizeResponseTimeout(7)).toBe(RESPONSE_TIMEOUT_DEFAULT_MINUTES);
		expect(normalizeResponseTimeout(99)).toBe(RESPONSE_TIMEOUT_DEFAULT_MINUTES);
		expect(normalizeResponseTimeout(-1)).toBe(RESPONSE_TIMEOUT_DEFAULT_MINUTES);
	});

	it("returns default for non-integer numbers", () => {
		expect(normalizeResponseTimeout(2.5)).toBe(
			RESPONSE_TIMEOUT_DEFAULT_MINUTES,
		);
		expect(normalizeResponseTimeout(NaN)).toBe(
			RESPONSE_TIMEOUT_DEFAULT_MINUTES,
		);
		expect(normalizeResponseTimeout(Infinity)).toBe(
			RESPONSE_TIMEOUT_DEFAULT_MINUTES,
		);
	});

	it("parses valid string values", () => {
		expect(normalizeResponseTimeout("5")).toBe(5);
		expect(normalizeResponseTimeout("10")).toBe(10);
		expect(normalizeResponseTimeout("60")).toBe(60);
	});

	it("returns default for invalid string values", () => {
		expect(normalizeResponseTimeout("abc")).toBe(
			RESPONSE_TIMEOUT_DEFAULT_MINUTES,
		);
		expect(normalizeResponseTimeout("2.5")).toBe(
			RESPONSE_TIMEOUT_DEFAULT_MINUTES,
		);
	});

	it("returns default for empty/whitespace strings", () => {
		expect(normalizeResponseTimeout("")).toBe(RESPONSE_TIMEOUT_DEFAULT_MINUTES);
		expect(normalizeResponseTimeout("  ")).toBe(
			RESPONSE_TIMEOUT_DEFAULT_MINUTES,
		);
	});

	it("returns default for non-number/string types", () => {
		expect(normalizeResponseTimeout(null)).toBe(
			RESPONSE_TIMEOUT_DEFAULT_MINUTES,
		);
		expect(normalizeResponseTimeout(undefined)).toBe(
			RESPONSE_TIMEOUT_DEFAULT_MINUTES,
		);
		expect(normalizeResponseTimeout(true)).toBe(
			RESPONSE_TIMEOUT_DEFAULT_MINUTES,
		);
		expect(normalizeResponseTimeout({})).toBe(RESPONSE_TIMEOUT_DEFAULT_MINUTES);
		expect(normalizeResponseTimeout([])).toBe(RESPONSE_TIMEOUT_DEFAULT_MINUTES);
	});
});
