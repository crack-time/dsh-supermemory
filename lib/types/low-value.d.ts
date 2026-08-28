/**
 * Low-value turn detection: skip persisting bare acknowledgments, single-
 * character choices, and continuation commands ("ok", "do it", etc.).
 *
 * The phrase table is kept explicit and readable (not a giant regex) so the
 * strict-mode list is easy to extend in either language.  Phrases are matched
 * EXACTLY (whitespace-normalized, case-folded) — a phrase inside a longer
 * sentence is never a match.
 */
/** Strict: skip persisting when EVERY real user message in the turn is low-value. */
export declare function isTurnLowValue(transcript: string): boolean;
