/**
 * Document audit tool: scan every document in a container, report its
 * processing status, content size and extracted-memory count, and flag
 * likely-low-value documents (empty greetings / self-introductions with no
 * extracted memories) so the model can decide what to clean up.
 *
 * Read-only: never deletes. Cleaning is done with the existing forget /
 * delete tools, so this tool is purely a "visibility + triage" pass.
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
import { activeContainer, argString, requireUpstream } from '../config.ts';

/**
 * Heuristics for "likely low value". A document is flagged low-value when it
 * has NO extracted memories AND its content is empty-ish (short or dominated by
 * greetings/self-introductions/acknowledgments). We keep it cheap and explicit;
 * the model does the final call.
 */
function flagLowValue(content: string, memCount: number): { low: boolean; reason?: string } {
    const text = (content ?? '').trim();
    const alnum = text.replace(/[^\p{L}\p{N}]/gu, '');
    if (memCount === 0) {
        if (alnum.length === 0) return { low: true, reason: 'empty content' };
        if (alnum.length < 30) return { low: true, reason: 'short content, no memories extracted' };
    }
    // Greeting-only content with no memories.
    if (memCount === 0 && text.length < 800) {
        const greetingOnly =
            /^(user:)?\s*(hi+|hello+|hey+|你好|嗨|在吗|嗯|哦)\b/.test(text.replace(/\s+/g, ' '))
            && !/[?？]/.test(text);
        if (greetingOnly) return { low: true, reason: 'greeting-only, no memories' };
    }
    return { low: false };
}

/** Fetch a single document's detail (content + memories + status) from upstream. */
async function fetchDocDetail(
    base: string,
    apiKey: string,
    docId: string,
    signal: AbortSignal,
): Promise<{ content: string; memCount: number; status: string; customId: string }> {
    const res = await fetch(base + '/v3/documents/' + encodeURIComponent(docId), {
        headers: { authorization: 'Bearer ' + apiKey },
        signal,
    });
    if (!res.ok) return { content: '', memCount: -1, status: 'not-found', customId: '' }; // -1 = detail fetch failed
    const data = (await res.json()) as { content?: string; memories?: unknown[]; status?: string; customId?: string };
    return {
        content: data.content ?? '',
        memCount: Array.isArray(data.memories) ? data.memories.length : 0,
        status: data.status ?? 'unknown',
        customId: data.customId ?? '',
    };
}

/**
 * supermemory audit tool: enumerate every document in a container and flag
 * low-value / broken candidates. Read-only.
 */
export function makeAuditDocsTool(scope: SettingsScope<any>): ToolDefinition {
    return {
        name: 'supermemory_audit_docs',
        description:
            'Audit documents in a container (or inspect specific docs by id): report processing status, content size, extracted-memory count, and flag likely-low-value documents (empty greetings / self-introductions with no memories) and broken (failed) documents. To inspect specific docs, pass their ids — useful to verify a doc before deleting. READ-ONLY — never deletes. Use it to triage what to clean up, then use supermemory_forget / supermemory_delete_document to act.',
        parameters: {
            type: 'object',
            properties: {
                ids: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional: document id(s) to inspect directly instead of scanning the whole container. When provided, only these docs are checked and containerTag is ignored.',
                },
                containerTag: {
                    type: 'string',
                    description: 'Container tag to audit. Defaults to the active container.',
                    default: '',
                },
                showAll: {
                    type: 'boolean',
                    description: 'When false (default) only return docs flagged low-value or failed; when true return every doc with its metrics.',
                    default: false,
                },
            },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    containerTag: { type: 'string' },
                    total: { type: 'number' },
                    summary: {
                        type: 'object',
                        properties: {
                            status: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        status: { type: 'string' },
                                        count: { type: 'number' },
                                    },
                                    required: ['status', 'count'],
                                },
                            },
                            lowValue: { type: 'number' },
                            failed: { type: 'number' },
                        },
                        required: ['status', 'lowValue', 'failed'],
                        additionalProperties: false,
                    },
                    flagged: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                customId: { type: 'string' },
                                status: { type: 'string' },
                                contentLen: { type: 'number' },
                                memCount: { type: 'number' },
                                lowValue: { type: 'boolean' },
                                reason: { type: 'string' },
                            },
                            required: ['id'],
                        },
                    },
                },
                required: ['containerTag', 'total', 'summary', 'flagged'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const v = value as { containerTag?: string; total?: number; summary?: { status?: Array<{ status: string; count: number }>; lowValue?: number; failed?: number }; flagged?: Array<{ id: string; customId?: string; status?: string; contentLen?: number; memCount?: number; lowValue?: boolean; reason?: string }> };
                const lines: string[] = [];
                lines.push(`Audit "${v.containerTag}" — ${v.total ?? 0} documents.`);
                const st = v.summary?.status ?? [];
                lines.push('  status: ' + st.map((s) => `${s.status}=${s.count}`).join(', '));
                lines.push(`  lowValue=${v.summary?.lowValue ?? 0}  failed=${v.summary?.failed ?? 0}`);
                lines.push('  flagged docs:');
                for (const d of v.flagged ?? []) {
                    lines.push(`    [${d.id}] ${d.lowValue ? 'LOW' : ''}${d.status === 'failed' ? 'FAILED' : ''}${d.reason ? ' (' + d.reason + ')' : ''} — len=${d.contentLen} mem=${d.memCount} ${d.customId ? d.customId.slice(0, 40) : ''}`);
                }
                return [{ type: 'text', text: lines.join('\n') }];
            },
        },
        execute: async (args, exec) => {
            const a = (args ?? {}) as { ids?: unknown; containerTag?: unknown; showAll?: boolean };
            const ids = Array.isArray(a.ids)
                ? a.ids.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
                : [];
            const tag = argString(a.containerTag, activeContainer(scope));
            const showAll = a.showAll === true;
            const { base, apiKey } = requireUpstream(scope);

            // If explicit ids are given, inspect only those docs (skip container scan).
            const docs: Array<{ id: string; customId?: string; status?: string }> = [];
            if (ids.length > 0) {
                docs.push(...ids.map((id) => ({ id })));
            }
            else {
                // 1. Enumerate every document summary in the container (paginate over all pages).
                const MAX_PAGES = 20;
                let page = 1;
                let totalPages = 1;
                do {
                    const res = await fetch(base + '/v3/documents/list', {
                        method: 'POST',
                        headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
                        body: JSON.stringify({ limit: 200, page }),
                        signal: AbortSignal.timeout(15000),
                    });
                    if (!res.ok) {
                        throw new Error('supermemory /v3/documents/list failed: HTTP ' + res.status + ' — ' + (await res.text()).slice(0, 200));
                    }
                    const data = (await res.json()) as {
                        memories?: Array<{ id: string; customId?: string; status?: string; containerTag?: string; containerTags?: string[] }>;
                        pagination?: { currentPage?: number; totalPages?: number };
                    };
                    for (const d of data.memories ?? []) {
                        let match = false;
                        if (Array.isArray(d.containerTags)) match = d.containerTags.includes(tag);
                        else if (typeof d.containerTag === 'string') match = d.containerTag === tag;
                        if (match) docs.push({ id: d.id, customId: d.customId, status: d.status });
                    }
                    totalPages = data.pagination?.totalPages ?? 1;
                    page = (data.pagination?.currentPage ?? page) + 1;
                } while (page <= totalPages && page <= MAX_PAGES);
            }

            // 2. Fetch each doc's detail (bounded concurrency) to get content length + memory count.
            const statusDist: Record<string, number> = {};
            const flagged: Array<{ id: string; customId: string; status: string; contentLen: number; memCount: number; lowValue: boolean; reason?: string }> = [];
            let lowValueCount = 0;
            let failedCount = 0;

            const CONC = 6;
            let i = 0;
            async function worker() {
                while (i < docs.length) {
                    const idx = i++;
                    const doc = docs[idx];
                    if (!doc) continue;
                    // Fetch detail (GET returns content + memories + status).
                    const detail = await fetchDocDetail(base, apiKey, doc.id, exec.signal);
                    const st = detail.status === 'not-found' ? (doc.status ?? 'not-found') : detail.status;
                    statusDist[st] = (statusDist[st] ?? 0) + 1;
                    if (st === 'failed') failedCount += 1;
                    const { low, reason } = flagLowValue(detail.content, detail.memCount);
                    if (low) lowValueCount += 1;
                    const isFlagged = showAll || low || st === 'failed';
                    if (isFlagged) {
                        flagged.push({
                            id: doc.id,
                            customId: detail.customId || doc.customId || '',
                            status: st,
                            contentLen: detail.content.length,
                            memCount: detail.memCount,
                            lowValue: low,
                            ...(reason ? { reason } : {}),
                        });
                    }
                }
            }
            const workers = Array.from({ length: CONC }, () => worker());
            await Promise.allSettled(workers);

            flagged.sort((a, b) => (b.lowValue ? 1 : 0) - (a.lowValue ? 1 : 0) || a.id.localeCompare(b.id));

            return {
                containerTag: tag,
                total: docs.length,
                summary: {
                    status: Object.entries(statusDist).map(([status, count]) => ({ status, count })),
                    lowValue: lowValueCount,
                    failed: failedCount,
                },
                flagged,
            };
        },
        timeoutMs: 120000,
    };
}