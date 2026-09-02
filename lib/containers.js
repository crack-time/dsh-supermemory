import { DEFAULT_CONTAINER, activeContainer, requireUpstream } from './config.js';
import { apiFetch, containerTagsOf, listDocumentPages } from './upstream.js';
/** Discover every container present upstream and fetch profile + doc counts. */
export async function discoverContainers(base, apiKey, opts = {}) {
    const maxTags = opts.maxTags ?? 50;
    const defaults = opts.defaults ?? [DEFAULT_CONTAINER];
    const signal = opts.timeoutMs !== undefined ? AbortSignal.timeout(opts.timeoutMs) : undefined;
    // 1. Walk every document (no container filter) and count each tag.
    const docCounts = new Map();
    await listDocumentPages(base, apiKey, { limit: 1000, signal }, (docs) => {
        for (const d of docs) {
            for (const tag of containerTagsOf(d)) {
                docCounts.set(tag, (docCounts.get(tag) ?? 0) + 1);
            }
        }
    });
    // Always include the defaults so the list is never empty.
    for (const def of defaults) {
        if (!docCounts.has(def))
            docCounts.set(def, 0);
    }
    // 2. Fetch each tag's profile counts IN PARALLEL (bounded). A slow tag
    //    no longer serializes the rest; individual failures keep zeros.
    const tags = [...docCounts.keys()].slice(0, maxTags);
    const counts = await Promise.all(tags.map((tag) => profileCounts(base, apiKey, tag)));
    const entries = tags.map((tag, i) => {
        const c = counts[i] ?? { staticCount: 0, dynamicCount: 0 };
        return {
            tag,
            staticCount: c.staticCount,
            dynamicCount: c.dynamicCount,
            docCount: docCounts.get(tag) ?? 0,
        };
    });
    entries.sort((a, b) => b.docCount - a.docCount || b.staticCount + b.dynamicCount - (a.staticCount + a.dynamicCount));
    return entries;
}
/** Fetch the stored profile (static + dynamic facts) for the given container. */
export async function fetchProfile(scope, containerTag) {
    const { base, apiKey } = requireUpstream(scope);
    let data;
    try {
        data = await apiFetch(base, apiKey, '/v4/profile', {
            method: 'POST',
            body: { containerTag: containerTag || activeContainer(scope) },
            timeoutMs: 10000,
        });
    }
    catch {
        data = undefined;
    }
    const lines = [];
    const stat = data?.profile?.static ?? [];
    const dyn = data?.profile?.dynamic ?? [];
    if (stat.length > 0)
        lines.push('Long-term facts (static):\n- ' + stat.join('\n- '));
    if (dyn.length > 0)
        lines.push('Recent dynamics (dynamic):\n- ' + dyn.join('\n- '));
    return lines.join('\n\n');
}
/** Fetch a tag's raw profile counts (for the select/list tools and card). Never throws. */
export async function profileCounts(base, apiKey, tag) {
    try {
        const data = await apiFetch(base, apiKey, '/v4/profile', {
            method: 'POST',
            body: { containerTag: tag },
            timeoutMs: 5000,
        });
        return {
            staticCount: (data.profile?.static ?? []).length,
            dynamicCount: (data.profile?.dynamic ?? []).length,
        };
    }
    catch { /* keep zeros */ }
    return { staticCount: 0, dynamicCount: 0 };
}
