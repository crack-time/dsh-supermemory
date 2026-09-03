/**
 * Turn transcript composition: extract human-readable text from a finished
 * turn event span so it can be persisted as a supermemory document.
 *
 * Excluded: injected/synthetic messages (source.kind !== "user") and tool
 * result details — only user queries, assistant replies, and tool call
 * signatures are captured.
 */
import type { Session } from '@deepseek-ai/dsh-session';
/** Extract the plain-text segments from a message content blocks. */
export declare function messageText(content: readonly unknown[]): string;
/**
 * Compose the transcript of one finished turn into a self-contained document.
 *
 * Scans from the tail of the event log — the matching turn/start is the last
 * one (turns are sequential, this turn just ended) — so the cost is
 * O(this turn events) rather than O(all events) for long sessions.
 */
export declare function turnTranscript(session: Session, turn: number, maxChars?: number): string;
