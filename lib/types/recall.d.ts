/**
 * Pure helpers for per-message dynamic recall. Dependency-free so they can be
 * unit-tested (see test/recall.test.mjs) and reused by the hooks orchestration.
 *
 * Rendered hits are explicitly tagged as UNTRUSTED historical data — memories
 * are injected into the system prompt, so anything retrieved must be bounded
 * and flagged as reference-only to guard against stored prompt-injection.
 */
/** Normalize a user message so near-identical repeats don't re-trigger a search. */
export declare function recallSignature(text: string): string;
/** Bounded top-k limit shared by the search call and the renderer. */
export declare function clampTopK(value: number): number;
/**
 * Render cached hits as an untrusted memory block, or an empty string when
 * there are no hits. `topK` caps the number of memories, `maxChars` the total.
 */
export declare function renderRecall(hits: ReadonlyArray<{
    memory: string;
}>, topK: number, maxChars: number): string;
