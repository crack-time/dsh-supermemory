/**
 * Transcript composition: extract human-readable text from session event logs
 * so they can be persisted as a supermemory document.
 *
 * Excluded: injected/synthetic messages (source.kind !== "user") and tool
 * result details — only user queries, assistant replies, and tool call
 * signatures are captured. turnTranscript covers one finished turn;
 * sessionTranscript covers a session's full event history (archive-time write).
 */
import type { Session } from '@deepseek-ai/dsh-session';
/** Extract the plain-text segments from a message content blocks. */
export declare function messageText(content: readonly unknown[]): string;
/** Compose the transcript of ONE finished turn into a self-contained document. */
export declare function turnTranscript(session: Session, turn: number, maxChars?: number): string;
/**
 * Compose the transcript of an ENTIRE session from its full event history.
 *
 * Unlike turnTranscript (one turn, backward scan + break at turn/end), this
 * walks the whole log forward and keeps going across turn boundaries, so it is
 * suitable for the archive-time write where the session's complete span is
 * needed regardless of how memory-resident or cold the session is. No
 * hard truncation is applied: value is judged by content, not length.
 */
export declare function sessionTranscript(session: Session): string;
