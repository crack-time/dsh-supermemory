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
        border: 'none',
        fontSize: '12px',
        fontWeight: 500,
        lineHeight: '17px',
        color: 'var(--dsw-alias-text-2, rgba(0,0,0,0.6))',
        background: 'transparent',
        whiteSpace: 'nowrap',
        cursor: 'default',
        userSelect: 'none',
    },
    icon: {
        width: '14px',
        height: '14px',
        opacity: 0.6,
    },
};
/** SVG memory icon — dual-chip design (viewBox 0 0 1024 1024). */
function MemoryIcon() {
    return (_jsx("svg", { style: STYLES.icon, viewBox: "0 0 1024 1024", fill: "currentColor", children: _jsx("path", { d: "M303.5392 51.2C387.9168 51.2 457.6 115.1488 468.0448 197.888a18.5344 18.5344 0 0 1 1.3824 6.8096v653.7216a19.6096 19.6096 0 0 1-3.7888 11.4688c-16.384 75.5712-82.7392 132.1472-162.0992 132.1472-91.5968 0-165.888-75.3664-165.888-168.3456l0.256-7.0656a165.2224 165.2224 0 0 1-14.8992-3.328C34.5344 799.232-17.9456 706.8672 5.76 616.96c8.704-32.8704 26.5728-61.2864 50.4832-82.688A169.8816 169.8816 0 0 1 5.7088 364.4416a166.8608 166.8608 0 0 1 133.4272-122.6752 166.0416 166.0416 0 0 1-1.536-22.1696C137.7024 126.5664 211.9936 51.2 303.5904 51.2z m0 84.1728c-45.7728 0-82.944 37.6832-82.944 84.224 0 16.0256 4.4032 31.2832 12.5952 44.544l-1.536-2.9184a42.5472 42.5472 0 0 1 7.5776 30.208l-0.7168 3.7376 0.3072-1.0752-0.256 1.0752-0.256 1.0752-0.1024 0.6656a43.3664 43.3664 0 0 1-1.3824 4.4032l-0.9216 2.1504a41.0624 41.0624 0 0 1-52.6336 22.3232 82.688 82.688 0 0 0-97.4336 60.416A84.3264 84.3264 0 0 0 144.4608 489.4208c12.2368 3.328 24.6784 3.7888 36.7104 1.4848l8.96-2.2528 4.6592-1.1776a41.4208 41.4208 0 0 1 47.104 29.0816 42.24 42.24 0 0 1-27.4944 52.6336 162.6112 162.6112 0 0 1-56.6784 7.168l-4.864 1.1264-6.3488 1.28c-29.1328 7.168-52.6848 29.8496-60.672 60.1088A84.3264 84.3264 0 0 0 144.4608 741.888c7.7824 2.0992 15.6672 3.072 23.552 2.8672l-5.2736-0.1536 0.1024-0.1536a41.1136 41.1136 0 0 1 57.1904-13.3632 42.496 42.496 0 0 1 15.4624 53.6576l-2.304 4.352a84.48 84.48 0 0 0-12.544 44.544c0 46.4896 37.12 84.1728 82.944 84.1728 45.7728 0 82.944-37.6832 82.944-84.1728v-256.3072c0-58.112-46.4384-105.2672-103.7312-105.2672a41.7792 41.7792 0 0 1-41.472-42.0864c0-23.2448 18.5856-42.0864 41.472-42.0864 38.4 0 74.0864 11.776 103.7312 31.9488V219.5968c0-46.5408-37.1712-84.224-82.944-84.224zM720.6144 51.2c-84.3776 0-154.0608 63.9488-164.5056 146.688a18.5344 18.5344 0 0 0-1.3824 6.8096v653.7216c0 4.1984 1.3824 8.0384 3.7888 11.4688 16.384 75.5712 82.7392 132.1472 162.0992 132.1472 91.5968 0 165.888-75.3664 165.888-168.3456l-0.256-7.0656c4.9664-0.8704 9.984-1.9968 14.8992-3.328 88.4736-24.064 140.9536-116.4288 117.248-206.2848a168.5504 168.5504 0 0 0-50.4832-82.688c45.6704-40.96 67.328-105.984 50.4832-169.8816a166.8608 166.8608 0 0 0-133.4272-122.6752c1.024-7.2704 1.536-14.6944 1.536-22.1696 0-93.0304-74.2912-168.3968-165.888-168.3968z m0 84.1728c45.7728 0 82.944 37.6832 82.944 84.224 0 16.0256-4.4032 31.2832-12.5952 44.544l1.536-2.9184a42.5472 42.5472 0 0 0-7.5776 30.208l0.7168 3.7376-0.3072-1.0752 0.256 1.0752 0.256 1.0752 0.1024 0.6656a43.3664 43.3664 0 0 0 1.3824 4.4032l0.9216 2.1504a41.0624 41.0624 0 0 0 52.6336 22.3232 82.688 82.688 0 0 1 97.4336 60.416 84.3264 84.3264 0 0 1-58.624 103.168 81.2032 81.2032 0 0 1-36.7104 1.4848l-8.96-2.2528-4.6592-1.1776a41.4208 41.4208 0 0 0-47.104 29.0816c-6.656 22.272 5.632 45.824 27.4944 52.6336 18.3808 5.6832 37.5296 8.1408 56.6784 7.168l4.864 1.1264 6.3488 1.28c29.1328 7.168 52.6848 29.8496 60.672 60.1088a84.3264 84.3264 0 0 1-58.624 103.1168c-7.7824 2.0992-15.6672 3.072-23.552 2.8672l5.2736-0.1536-0.1024-0.1536a41.1136 41.1136 0 0 0-57.1904-13.3632 42.496 42.496 0 0 0-15.4624 53.6576l2.304 4.352c8.192 13.2096 12.544 28.5184 12.544 44.544 0 46.4896-37.12 84.1728-82.944 84.1728-45.7728 0-82.944-37.6832-82.944-84.1728v-256.3072c0-58.112 46.4384-105.2672 103.7312-105.2672 22.8864 0 41.472-18.8416 41.472-42.0864a41.7792 41.7792 0 0 0-41.472-42.0864c-38.4 0-74.0864 11.776-103.7312 31.9488V219.5968c0-46.5408 37.1712-84.224 82.944-84.224z" }) }));
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
