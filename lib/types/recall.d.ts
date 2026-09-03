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
/** Relevance-floor helper: clamp into [0, 1]. */
export declare function clampThreshold(value: number): number;
/**
 * Post-process raw /v4/search hits for injection: drop hits below the
 * relevance floor and de-duplicate by `rootMemoryId` (the server may return
 * several versions of the same underlying memory). Hits without a `similarity`
 * are kept (treated as passing the floor); hits without a `rootMemoryId`
 * de-duplicate by their text. Returns [{ memory }].
 */
export declare function filterSearchHits(raw: ReadonlyArray<unknown>, threshold: number): Array<{
    memory: string;
}>;
/**
 * Render cached hits as an untrusted memory block, or an empty string when
 * there are no hits. `topK` caps the number of memories, `maxChars` the total.
 */
export declare function renderRecall(hits: ReadonlyArray<{
    memory: string;
}>, topK: number, maxChars: number): string;
