/**
 * Generate a unique ID with the given prefix (e.g. "q", "tc", "rp", "att", "prob", "term", "ctx").
 */
export function generateId(prefix: string): string {
	return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}
