import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Compact memory-space selector for the input bar (conversation.input.right).
 *
 * Mirrors the ModelSelect trigger/menu aesthetic from
 * @deepseek-ai/dsh-client-ui-model-selection so the two selectors look like
 * siblings in the composer trailing area.
 */
import { useState, useEffect, useRef } from 'react';
import { API_URLS } from './api.js';
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
        fontWeight: 500,
        lineHeight: '20px',
        display: 'inline-flex',
        whiteSpace: 'nowrap',
        userSelect: 'none',
    },
    triggerHover: {
        background: 'var(--dsw-alias-interactive-bg-hover)',
    },
    icon: {
        width: '14px',
        height: '14px',
        flex: 'none',
        opacity: 0.7,
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
        flexDirection: 'column',
        padding: '4px',
        display: 'flex',
        position: 'absolute',
        bottom: 'calc(100% + 8px)',
        right: 0,
        overflowY: 'auto',
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
    },
    optionSelected: {
        background: 'var(--dsw-alias-interactive-bg-hover)',
        fontWeight: 600,
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
};
function MemoryIcon() {
    return (_jsxs("svg", { style: T.icon, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", children: [_jsx("ellipse", { cx: "8", cy: "4", rx: "5", ry: "2" }), _jsx("path", { d: "M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" }), _jsx("path", { d: "M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" })] }));
}
function ChevronDown({ open }) {
    return (_jsx("svg", { style: { ...T.chevron, ...(open ? T.chevronOpen : {}) }, viewBox: "0 0 12 12", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("path", { d: "M3 4.5L6 7.5L9 4.5" }) }));
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function MemorySelector(props) {
    const sessionId = props.sessionId;
    const [containers, setContainers] = useState([]);
    const [active, setActive] = useState('');
    const [open, setOpen] = useState(false);
    const [hovered, setHovered] = useState(null);
    const [triggerHover, setTriggerHover] = useState(false);
    const wrapperRef = useRef(null);
    useEffect(() => {
        let alive = true;
        async function load() {
            try {
                // Read the SESSION snapshot (not global config) so the selector
                // shows the container this session is actually bound to.
                const fetches = [fetch(API_URLS.containers)];
                if (sessionId)
                    fetches.push(fetch(API_URLS.sessionContainer(sessionId)));
                const results = await Promise.all(fetches);
                if (!alive)
                    return;
                const listRes = results[0];
                const sessionRes = sessionId ? results[1] : undefined;
                const list = listRes.ok ? await listRes.json() : {};
                const session = sessionRes?.ok ? await sessionRes.json() : {};
                setActive(session.containerTag ?? '');
                setContainers((list.containers ?? [])
                    .map((c) => ({
                    tag: c.tag,
                    staticCount: c.staticCount ?? 0,
                    dynamicCount: c.dynamicCount ?? 0,
                })));
            }
            catch {
                // Network failure: hide selector silently.
            }
        }
        load();
        return () => { alive = false; };
    }, [sessionId]);
    useEffect(() => {
        if (!open)
            return;
        const handler = (e) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);
    async function select(tag) {
        if (tag === active) {
            setOpen(false);
            return;
        }
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
            if (res.ok)
                setActive(tag);
        }
        catch { /* ignore */ }
        setOpen(false);
    }
    if (containers.length === 0)
        return null;
    return (_jsxs("div", { ref: wrapperRef, style: { position: 'relative', display: 'inline-flex', alignItems: 'center' }, children: [_jsxs("button", { type: "button", style: { ...T.trigger, ...(triggerHover ? T.triggerHover : {}) }, onClick: () => setOpen(!open), onMouseEnter: () => setTriggerHover(true), onMouseLeave: () => setTriggerHover(false), title: "Switch memory space", children: [_jsx(MemoryIcon, {}), _jsx("span", { style: { textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden' }, children: active || '—' }), _jsx(ChevronDown, { open: open })] }), open && (_jsx("div", { style: T.menu, children: containers.map((c) => (_jsxs("div", { style: {
                        ...T.option,
                        ...(c.tag === active ? T.optionSelected : {}),
                        ...(hovered === c.tag && c.tag !== active ? T.optionHover : {}),
                    }, onMouseEnter: () => setHovered(c.tag), onMouseLeave: () => setHovered(null), onClick: () => select(c.tag), children: [_jsx("span", { children: c.tag }), _jsx("span", { style: T.count, children: c.staticCount + c.dynamicCount })] }, c.tag))) }))] }));
}
