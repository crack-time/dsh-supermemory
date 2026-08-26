import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Header badge showing the active memory container name.
 *
 * Registers into the `conversation.session.header.actions` list slot
 * so it appears as a chip/badge next to the agent-preset label in the
 * session header area.
 */
import { useState, useEffect } from 'react';
import { API_URLS } from './api.js';
/** Inline styles matching the DSH badge aesthetic. */
const STYLES = {
    badge: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: '999px',
        border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12))',
        fontSize: '12px',
        fontWeight: 500,
        lineHeight: '17px',
        color: 'var(--dsw-alias-text-2, rgba(0,0,0,0.6))',
        background: 'var(--dsw-alias-bg-subtle, rgba(0,0,0,0.04))',
        whiteSpace: 'nowrap',
        cursor: 'default',
        userSelect: 'none',
    },
    icon: {
        width: '12px',
        height: '12px',
        opacity: 0.6,
    },
};
/** SVG memory icon (simplified database/cylinder). */
function MemoryIcon() {
    return (_jsxs("svg", { style: STYLES.icon, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", children: [_jsx("ellipse", { cx: "8", cy: "4", rx: "5", ry: "2" }), _jsx("path", { d: "M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" }), _jsx("path", { d: "M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" })] }));
}
/**
 * Memory space badge — rendered inside the session header actions list.
 * Props come from the DSH slot framework.
 */
export function MemorySpaceBadge(props) {
    const t = props.t;
    const [container, setContainer] = useState(null);
    // sessionId comes from the DSH slot framework via the inject face.
    const sessionId = props.sessionId;
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
                if (!res.ok)
                    return;
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
        const timer = setInterval(load, 30000);
        return () => { alive = false; clearInterval(timer); };
    }, [sessionId]);
    if (!container)
        return null;
    const label = t?.('activeContainer') ?? 'Space';
    return (_jsxs("span", { style: STYLES.badge, title: `${label}: ${container}`, children: [_jsx(MemoryIcon, {}), container] }));
}
