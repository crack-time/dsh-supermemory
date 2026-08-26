import { DEFAULT_CONTAINER, activeContainer, requireUpstream } from './config.js';
/** Discover every container present upstream and fetch profile + doc counts. */
export async function discoverContainers(base, apiKey, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 8000;
    const maxTags = opts.maxTags ?? 50;
    const defaults = opts.defaults ?? [DEFAULT_CONTAINER];
    // 1. List every document (no container filter) and read its containerTags.
    const listRes = await fetch(base + '/v3/documents/list', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ limit: 1000 }),
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!listRes.ok) {
        throw new Error('documents list failed: HTTP ' + listRes.status);
    }
    const listData = (await listRes.json());
    const docCounts = new Map();
    for (const d of listData.memories ?? []) {
        let tags = [];
        if (Array.isArray(d.containerTags))
            tags = d.containerTags;
        else if (typeof d.containerTag === 'string' && d.containerTag.trim())
            tags = [d.containerTag.trim()];
        if (tags.length === 0)
            continue;
        for (const tag of tags) {
            if (!tag.trim())
                continue;
            docCounts.set(tag, (docCounts.get(tag) ?? 0) + 1);
        }
    }
    // Always include the defaults so the list is never empty.
    for (const def of defaults) {
        if (!docCounts.has(def))
            docCounts.set(def, 0);
    }
    // 2. Fetch each tag's profile counts IN PARALLEL (bounded). A slow tag
    //    no longer serializes the rest; individual failures keep zeros.
    const tags = [...docCounts.keys()].slice(0, maxTags);
    const results = await Promise.allSettled(tags.map(async (tag) => {
        const res = await fetch(base + '/v4/profile', {
            method: 'POST',
            headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
            body: JSON.stringify({ containerTag: tag }),
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok)
            return { staticCount: 0, dynamicCount: 0 };
        const data = (await res.json());
        return {
            staticCount: (data.profile?.static ?? []).length,
            dynamicCount: (data.profile?.dynamic ?? []).length,
        };
    }));
    const entries = tags.map((tag, i) => {
        const r = results[i];
        if (r && r.status === 'fulfilled') {
            return { tag, staticCount: r.value.staticCount, dynamicCount: r.value.dynamicCount, docCount: docCounts.get(tag) ?? 0 };
        }
        return { tag, staticCount: 0, dynamicCount: 0, docCount: docCounts.get(tag) ?? 0 };
    });
    entries.sort((a, b) => b.docCount - a.docCount || b.staticCount + b.dynamicCount - (a.staticCount + a.dynamicCount));
    return entries;
}
/** Fetch the stored profile (static + dynamic facts) for the given container. */
export async function fetchProfile(scope, containerTag) {
    const { base, apiKey } = requireUpstream(scope);
    const res = await fetch(base + '/v4/profile', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ containerTag: containerTag || activeContainer(scope) }),
        signal: AbortSignal.timeout(10000),
    });
    if (!res.ok)
        return '';
    const data = (await res.json());
    const lines = [];
    const stat = data.profile?.static ?? [];
    const dyn = data.profile?.dynamic ?? [];
    if (stat.length > 0)
        lines.push('长期事实 (static):\n- ' + stat.join('\n- '));
    if (dyn.length > 0)
        lines.push('近期动态 (dynamic):\n- ' + dyn.join('\n- '));
    return lines.join('\n\n');
}
/** Fetch a tag's raw profile counts (for the select/list tools and card). */
export async function profileCounts(base, apiKey, tag) {
    try {
        const res = await fetch(base + '/v4/profile', {
            method: 'POST',
            headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
            body: JSON.stringify({ containerTag: tag }),
            signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
            const data = (await res.json());
            return {
                staticCount: (data.profile?.static ?? []).length,
                dynamicCount: (data.profile?.dynamic ?? []).length,
            };
        }
    }
    catch { /* keep zeros */ }
    return { staticCount: 0, dynamicCount: 0 };
}
