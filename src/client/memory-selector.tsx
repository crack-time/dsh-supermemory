/**
 * Compact memory-space selector for the input bar (conversation.input.right).
 *
 * Mirrors the ModelSelect trigger/menu aesthetic from
 * @deepseek-ai/dsh-client-ui-model-selection so the two selectors look like
 * siblings in the composer trailing area.
 */
import { useState, useEffect, useRef } from 'react';
import { API_URLS } from './api.ts';

interface ContainerInfo {
    tag: string;
    staticCount: number;
    dynamicCount: number;
}

// Design tokens copied from ModelSelect.module.css so we stay pixel-perfect
// with the model selector without importing its private CSS module.
const T = {
    trigger: {
        minWidth: 0,
        maxWidth: 'min(360px, 45cqw)',
        height: '28px',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
        background: 'transparent',
        border: 'none',
        borderRadius: '24px',
        outline: 'none',
        alignItems: 'center',
        gap: '4px',
        padding: '0 8px',
        fontSize: '13px',
        fontWeight: 500 as const,
        lineHeight: '20px',
        fontFamily: 'var(--dsw-font-family)',
        display: 'inline-flex',
        whiteSpace: 'nowrap' as const,
        userSelect: 'none' as const,
    },
    triggerHover: {
        background: 'var(--dsw-alias-interactive-bg-hover)',
    },
    chevron: {
        color: 'var(--dsw-alias-label-caption)',
        flex: 'none',
        transition: 'transform .12s',
        width: '12px',
        height: '12px',
    },
    chevronOpen: {
        transform: 'rotate(180deg)',
    },
    menu: {
        zIndex: 20,
        border: '1px solid var(--dsw-alias-border-inverted)',
        background: 'var(--dsw-specific-menu)',
        width: 'max-content',
        minWidth: 'min(200px, 100vw - 32px)',
        maxWidth: 'min(320px, 100vw - 32px)',
        maxHeight: 'min(360px, 100vh - 96px)',
        boxShadow: 'var(--dsw-shadow-lv3)',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: '12px',
        flexDirection: 'column' as const,
        padding: '4px',
        display: 'flex',
        position: 'absolute' as const,
        bottom: 'calc(100% + 8px)',
        right: 0,
        overflowY: 'auto' as const,
        fontFamily: 'var(--dsw-font-family)',
    },
    option: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 8px',
        fontSize: '13px',
        lineHeight: '20px',
        cursor: 'pointer',
        borderRadius: '8px',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'var(--dsw-font-family)',
    },
    optionSelected: {
        background: 'var(--dsw-alias-interactive-bg-hover)',
        fontWeight: 600 as const,
    },
    optionHover: {
        background: 'var(--dsw-alias-interactive-bg-hover)',
    },
    count: {
        fontSize: '12px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-caption)',
        marginLeft: '8px',
        flex: 'none',
    },
} as const;

function ChevronDown({ open }: { open: boolean }) {
    return (
        <svg
            style={{ ...T.chevron, ...(open ? T.chevronOpen : {}) }}
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
    );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function MemorySelector(props: any) {
    const sessionId = props.sessionId as string | undefined;
    const [containers, setContainers] = useState<ContainerInfo[]>([]);
    const [active, setActive] = useState<string>('');
    const [open, setOpen] = useState(false);
    const [hovered, setHovered] = useState<string | null>(null);
    const [triggerHover, setTriggerHover] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let alive = true;
        async function load() {
            try {
                // Read the SESSION snapshot (not global config) so the selector
                // shows the container this session is actually bound to.
                const fetches: Promise<Response>[] = [fetch(API_URLS.containers)];
                if (sessionId) fetches.push(fetch(API_URLS.sessionContainer(sessionId)));
                const results = await Promise.all(fetches);
                if (!alive) return;
                const listRes = results[0]!;
                const sessionRes = sessionId ? results[1] : undefined;
                const list = listRes.ok ? await listRes.json() : {};
                const session = sessionRes?.ok ? await sessionRes.json() : {};
                setActive(session.containerTag ?? '');
                setContainers(
                    ((list.containers ?? []) as Array<{ tag: string; staticCount?: number; dynamicCount?: number }>)
                        .map((c) => ({
                            tag: c.tag,
                            staticCount: c.staticCount ?? 0,
                            dynamicCount: c.dynamicCount ?? 0,
                        }))
                );
            } catch {
                // Network failure: hide selector silently.
            }
        }
        load();
        return () => { alive = false; };
    }, [sessionId]);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    async function select(tag: string) {
        if (tag === active) { setOpen(false); return; }
        try {
            // Write to the SESSION snapshot (not global config) so only this
            // session's injection + persistence are affected.
            const url = sessionId
                ? API_URLS.sessionContainer(sessionId)
                : API_URLS.activeContainer;
            const res = await fetch(url, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ containerTag: tag }),
            });
            if (res.ok) setActive(tag);
        } catch { /* ignore */ }
        setOpen(false);
    }

    if (containers.length === 0) return null;

    return (
        <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <button
                type="button"
                style={{ ...T.trigger, ...(triggerHover ? T.triggerHover : {}) }}
                onClick={() => setOpen(!open)}
                onMouseEnter={() => setTriggerHover(true)}
                onMouseLeave={() => setTriggerHover(false)}
                title="Switch memory space"
            >
                <span style={{ textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden' }}>
                    {active || '—'}
                </span>
                <ChevronDown open={open} />
            </button>
            {open && (
                <div style={T.menu}>
                    {containers.map((c) => (
                        <div
                            key={c.tag}
                            style={{
                                ...T.option,
                                ...(c.tag === active ? T.optionSelected : {}),
                                ...(hovered === c.tag && c.tag !== active ? T.optionHover : {}),
                            }}
                            onMouseEnter={() => setHovered(c.tag)}
                            onMouseLeave={() => setHovered(null)}
                            onClick={() => select(c.tag)}
                        >
                            <span>{c.tag}</span>
                            <span style={T.count}>{c.staticCount + c.dynamicCount}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
