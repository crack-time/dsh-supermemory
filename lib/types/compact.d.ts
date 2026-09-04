/**
 * LLM-based compaction of an archived session transcript.
 *
 * The deterministic layer (transcript.ts) already strips tool-call arguments
 * and excludes tool results. This optional pass condenses the remaining
 * user/assistant narrative into a denser record — keeping decisions, facts
 * and concrete parameters while dropping redundant wording — using the same
 * OpenAI-compatible endpoint the managed server uses for dreaming/embedding.
 *
 * Non-fatal by design: if the endpoint isn't configured, times out, or returns
 * empty, the original transcript is returned unchanged and archiving proceeds.
 */
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
export interface CompactResult {
    text: string;
    compacted: boolean;
}
/**
 * Condense a session transcript via an OpenAI-compatible /chat/completions call.
 * Reads the same openaiBaseUrl / openaiApiKey / openaiModel the managed server
 * is configured with. Never throws and never blocks archiving: any failure or
 * missing config returns the input unchanged (`compacted: false`).
 */
export declare function compactTranscript(scope: SettingsScope<any>, text: string): Promise<CompactResult>;
