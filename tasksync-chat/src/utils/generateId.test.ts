import { describe, expect, it } from "vitest";
import { generateId } from "../utils/generateId";

describe("generateId", () => {
	it("returns a string starting with the given prefix", () => {
		const id = generateId("q");
		expect(id.startsWith("q_")).toBe(true);
	});

	it("contains a timestamp segment", () => {
		const before = Date.now();
		const id = generateId("tc");
		const after = Date.now();

		const parts = id.split("_");
		// format: prefix_timestamp_random
		expect(parts.length).toBe(3);

		const ts = Number(parts[1]);
		expect(ts).toBeGreaterThanOrEqual(before);
		expect(ts).toBeLessThanOrEqual(after);
	});

	it("contains a random alphanumeric suffix", () => {
		const id = generateId("rp");
		const parts = id.split("_");
		const random = parts[2];

		expect(random.length).toBeGreaterThanOrEqual(1);
		expect(random.length).toBeLessThanOrEqual(9);
		// base-36 chars only
		expect(random).toMatch(/^[a-z0-9]+$/);
	});

	it("generates unique IDs on successive calls", () => {
		const ids = new Set(Array.from({ length: 50 }, () => generateId("u")));
		expect(ids.size).toBe(50);
	});

	it("works with various prefix values", () => {
		for (const prefix of ["q", "tc", "rp", "att", "prob", "term", "ctx"]) {
			const id = generateId(prefix);
			expect(id.startsWith(`${prefix}_`)).toBe(true);
		}
	});

	it("handles empty prefix", () => {
		const id = generateId("");
		expect(id.startsWith("_")).toBe(true);
	});
});
