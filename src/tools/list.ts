/**
 * List tools: container discovery and document listing.
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
import { activeContainer, argString, requireUpstream } from '../config.ts';
import { discoverContainers } from '../containers.ts';

/**
 * List-containers tool: show all memory spaces with their fact counts.
 */
export function makeListContainersTool(scope: SettingsScope<any>): ToolDefinition {
    return {
        name: 'supermemory_list_containers',
        description: 'List all memory spaces (container tags) with their fact counts. Use this to see what spaces exist before selecting one.',
        parameters: {
            type: 'object',
            properties: {},
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    containers: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                tag: { type: 'string' },
                                staticCount: { type: 'number' },
                                dynamicCount: { type: 'number' },
                            },
                            required: ['tag'],
                        },
                    },
                    active: { type: 'string' },
                },
                required: ['containers', 'active'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const v = value as { containers?: Array<{ tag: string; staticCount?: number; dynamicCount?: number }>; active?: string };
                const lines = (v.containers ?? []).map((c) => {
                    const marker = c.tag === v.active ? ' (active)' : '';
                    return '  - ' + c.tag + marker + ': ' + (c.staticCount ?? 0) + ' static + ' + (c.dynamicCount ?? 0) + ' dynamic';
                });
                const header = 'Memory spaces (' + (v.containers ?? []).length + '):';
                return [{ type: 'text', text: header + '\n' + lines.join('\n') }];
            },
        },
        execute: async () => {
            const { base, apiKey } = requireUpstream(scope);
            const active = activeContainer(scope);
            const entries = await discoverContainers(base, apiKey);
            const containers = entries.map((c) => ({
                tag: c.tag,
                staticCount: c.staticCount,
                dynamicCount: c.dynamicCount,
            }));
            return { containers, active };
        },
        timeoutMs: 20000,
    };
}

/**
 * List-documents tool: show documents in a memory space.
 */
export function makeListDocumentsTool(scope: SettingsScope<any>): ToolDefinition {
    return {
        name: 'supermemory_list_documents',
        description: 'List documents stored in a specific memory space (container tag). Returns document ids, titles, and metadata. Paginates over ALL pages server-side so total is the container\'s real document count (the upstream list endpoint ignores the container filter, so filtering happens here). Use this to review what is stored before deleting or managing documents.',
        parameters: {
            type: 'object',
            properties: {
                containerTag: {
                    type: 'string',
                    description: 'Container tag to list documents from.',
                    default: '',
                },
                limit: {
                    type: 'number',
                    description: 'Page size for the upstream pagination (1-1100). This is a per-page cap, not a total cap — the tool pages through everything.',
                    default: 100,
                },
            },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    containerTag: { type: 'string' },
                    total: { type: 'number' },
                    documents: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                title: { type: 'string' },
                                status: { type: 'string' },
                                createdAt: { type: 'string' },
                            },
                            required: ['id'],
                        },
                    },
                },
                required: ['containerTag', 'total', 'documents'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const v = value as { containerTag?: string; total?: number; documents?: Array<{ id: string; title?: string }> };
                const lines = (v.documents ?? []).slice(0, 20).map((d, i) => {
                    const t = (d.title || '').replace(/\n/g, ' ').slice(0, 80);
                    return (i + 1) + '. [' + d.id.slice(0, 10) + '] ' + t;
                });
                const more = (v.total ?? 0) > 20 ? '\n... and ' + ((v.total ?? 0) - 20) + ' more' : '';
                return [{ type: 'text', text: 'Documents in "' + v.containerTag + '" (' + v.total + '):\n' + lines.join('\n') + more }];
            },
        },
        execute: async (args) => {
            const a = (args ?? {}) as { containerTag?: unknown; limit?: unknown };
            const tag = argString(a.containerTag, activeContainer(scope));
            const rawLimit = typeof a.limit === 'number' ? a.limit : 100;
            // Upstream limit is capped at 1100 (server rejects anything larger).
            const limit = Math.min(1100, Math.max(1, Math.floor(rawLimit)));
            const { base, apiKey } = requireUpstream(scope);

            // The upstream /v3/documents/list IGNORES containerTag and returns
            // documents across every container (pagination.totalItems is global),
            // so we paginate over ALL pages and filter by the container's own
            // containerTags field. A page cap keeps runaway cases bounded.
            const MAX_PAGES = 20;
            const all: Array<{ id: string; title?: string; status?: string; createdAt?: string }> = [];
            let page = 1;
            let totalPages = 1;
            do {
                const res = await fetch(base + '/v3/documents/list', {
                    method: 'POST',
                    headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
                    body: JSON.stringify({ limit, page }),
                    signal: AbortSignal.timeout(15000),
                });
                if (!res.ok) {
                    throw new Error('supermemory /v3/documents/list failed: HTTP ' + res.status + ' — ' + (await res.text()).slice(0, 200));
                }
                const data = (await res.json()) as {
                    memories?: Array<{ id: string; title?: string; status?: string; createdAt?: string; containerTag?: string; containerTags?: string[] }>;
                    pagination?: { currentPage?: number; totalPages?: number };
                };
                const docs = data.memories ?? [];
                for (const d of docs) {
                    let match = false;
                    if (Array.isArray(d.containerTags)) match = d.containerTags.includes(tag);
                    else if (typeof d.containerTag === 'string') match = d.containerTag === tag;
                    if (match) all.push({ id: d.id, title: d.title, status: d.status, createdAt: d.createdAt });
                }
                totalPages = data.pagination?.totalPages ?? 1;
                page = (data.pagination?.currentPage ?? page) + 1;
            } while (page <= totalPages && page <= MAX_PAGES);

            return { containerTag: tag, total: all.length, documents: all };
        },
        timeoutMs: 60000,
    };
}

/** Register every AI-facing memory tool into the dsh tool runtime. */