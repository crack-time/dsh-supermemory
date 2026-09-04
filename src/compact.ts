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
import { resolveConfig } from './config.ts';

export interface CompactResult {
    text: string;
    compacted: boolean;
}

const COMPACTION_TIMEOUT_MS = 60_000;

const COMPACTION_SYSTEM = [
    'You condense an AI-assistant session transcript into a high-density memory record.',
    "Keep: the user's actual requests and questions, the assistant's conclusions and",
    'decisions, concrete facts, parameters, numbers, and any project- or',
    'environment-specific details. Keep it roughly chronological so the arc of the',
    'work stays readable. Drop: repeated/verbose reasoning, hedging, transient status',
    'chatter, and tool-name-only noise. Do not invent facts. Reply with only the',
    'condensed record, in the same language as the transcript.',
].join(' ');

/**
 * Condense a session transcript via an OpenAI-compatible /chat/completions call.
 * Reads the same openaiBaseUrl / openaiApiKey / openaiModel the managed server
 * is configured with. Never throws and never blocks archiving: any failure or
 * missing config returns the input unchanged (`compacted: false`).
 */
export async function compactTranscript(scope: SettingsScope<any>, text: string): Promise<CompactResult> {
    if (!text.trim()) return { text, compacted: false };
    const cfg = resolveConfig(scope);
    const base = (cfg.openaiBaseUrl ?? '').trim().replace(/\/+$/, '');
    if (!base || !cfg.openaiApiKey || !cfg.openaiModel) {
        return { text, compacted: false };
    }
    try {
        const res = await fetch(base + '/chat/completions', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: 'Bearer ' + cfg.openaiApiKey,
            },
            body: JSON.stringify({
                model: cfg.openaiModel,
                messages: [
                    { role: 'system', content: COMPACTION_SYSTEM },
                    { role: 'user', content: text },
                ],
                temperature: 0.2,
            }),
            signal: AbortSignal.timeout(COMPACTION_TIMEOUT_MS),
        });
        if (!res.ok) return { text, compacted: false };
        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const out = data?.choices?.[0]?.message?.content;
        if (typeof out !== 'string' || out.trim().length === 0) return { text, compacted: false };
        return { text: out.trim(), compacted: true };
    }
    catch {
        return { text, compacted: false };
    }
}