/**
 * Header badge showing the active memory container name.
 *
 * Registers into the `conversation.session.header.actions` list slot
 * so it appears as a chip/badge next to the agent-preset label in the
 * session header area.
 */
import { useState, useEffect } from 'react';
import { API_URLS } from './api.ts';

/** Inline styles matching the DSH badge aesthetic. */
const STYLES = {
    badge: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: '999px',
        border: 'none',
        fontSize: '12px',
        fontWeight: 500 as const,
        lineHeight: '17px',
        color: 'var(--dsw-alias-text-2, rgba(0,0,0,0.6))',
        background: 'transparent',
        whiteSpace: 'nowrap' as const,
        cursor: 'default',
        userSelect: 'none' as const,
    },
    icon: {
        width: '14px',
        height: '14px',
        opacity: 0.6,
    },
};

/** SVG memory icon (simplified database/cylinder). */
function MemoryIcon() {
    return (
        <svg
            style={STYLES.icon}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
        >
            <ellipse cx="8" cy="4" rx="5" ry="2" />
            <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" />
            <path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
        </svg>
    );
}

/**
 * Memory space badge — rendered inside the session header actions list.
 * Props come from the DSH slot framework.
 */
export function MemorySpaceBadge(props: any) {
    const t = (props as { t?: (key: string) => string }).t;
    const [container, setContainer] = useState<string | null>(null);

    // sessionId comes from the DSH slot framework via the inject face.
    const sessionId: string | undefined = (props as { sessionId?: string }).sessionId;

    useEffect(() => {
        let alive = true;
        async function load() {
            try {
                // Primary: per-session container snapshot (from host sessionContainerRef).
                if (sessionId) {
                    const res = await fetch(API_URLS.sessionContainer(sessionId));
                    if (res.ok) {
                        const data = await res.json();
                        if (alive && data?.containerTag) {
                            setContainer(data.containerTag);
                            return;
                        }
                    }
                }
                // Fallback: global active container from settings.
                const res = await fetch(API_URLS.config);
                if (!res.ok) return;
                const data = await res.json();
                if (alive && data?.activeContainer) {
                    setContainer(data.activeContainer);
                }
            }
            catch {
                // Network failure: hide badge silently.
            }
        }
        load();
        const timer = setInterval(load, 30_000);
        return () => { alive = false; clearInterval(timer); };
    }, [sessionId]);

    if (!container) return null;

    const label = t?.('activeContainer') ?? 'Space';

    return (
        <span style={STYLES.badge} title={`${label}: ${container}`}>
            <MemoryIcon />
            {container}
        </span>
    );
}
