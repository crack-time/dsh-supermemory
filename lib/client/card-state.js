/**
 * Settings-card state + business logic, extracted from card.tsx so the
 * component keeps only JSX and the hook stays testable on its own.
 *
 * The hook owns: config IO (load/save/commit), container discovery
 * (cache-aware), connection test, and every piece of field state the card
 * renders. It takes the translation function and the patch channel as
 * dependencies (injected by the slot host), mirroring CardProps.
 */
import { useEffect, useRef, useState } from 'react';
import { API_URLS } from './api.js';
const CONTAINER_TTL_MS = 60000;
const DEFAULT_EMPTY = {
    baseUrl: '',
    apiKey: '',
    serverPath: '',
    openaiApiKey: '',
    openaiBaseUrl: '',
    openaiModel: '',
    activeContainer: '',
};
/** All state and actions behind the Supermemory settings card. */
export function useSupermemoryCard(deps) {
    const { t, applyPatch } = deps;
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [baseUrl, setBaseUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [serverPath, setServerPath] = useState('');
    const [openaiApiKey, setOpenaiApiKey] = useState('');
    const [openaiBaseUrl, setOpenaiBaseUrl] = useState('');
    const [openaiModel, setOpenaiModel] = useState('');
    const [activeContainer, setActiveContainer] = useState('');
    const [containers, setContainers] = useState([]);
    const [containersLoading, setContainersLoading] = useState(false);
    const [creatingContainer, setCreatingContainer] = useState(false);
    const [newContainerName, setNewContainerName] = useState('');
    const [managed, setManaged] = useState(null);
    const [server, setServer] = useState(null);
    const [saving, setSaving] = useState(false);
    const [saveFailed, setSaveFailed] = useState(false);
    const [justSaved, setJustSaved] = useState(false);
    const [testing, setTesting] = useState(false);
    const [status, setStatus] = useState(null);
    const [loadErr, setLoadErr] = useState(false);
    // Container-fetch cache: data is considered fresh for CONTAINER_TTL_MS.
    // The in-flight guard is a ref (not state) so it is synchronous —
    // near-simultaneous focus + click cannot both start a fetch.
    const containersFetchedAtRef = useRef(0);
    const containersInFlightRef = useRef(false);
    const dirty = server !== null &&
        (baseUrl.trim() !== server.baseUrl ||
            apiKey.trim() !== server.apiKey ||
            serverPath.trim() !== server.serverPath ||
            openaiApiKey.trim() !== server.openaiApiKey ||
            openaiBaseUrl.trim() !== server.openaiBaseUrl ||
            openaiModel.trim() !== server.openaiModel ||
            activeContainer.trim() !== (server.activeContainer ?? '').trim());
    async function load() {
        setLoadErr(false);
        setLoading(true);
        try {
            const res = await fetch(API_URLS.config, { cache: 'no-store' });
            if (!res.ok) {
                setLoadErr(true);
                return;
            }
            const cfg = (await res.json());
            setBaseUrl(cfg.baseUrl ?? '');
            setApiKey(cfg.apiKey ?? '');
            setServerPath(cfg.serverPath ?? '');
            setOpenaiApiKey(cfg.openaiApiKey ?? '');
            setOpenaiBaseUrl(cfg.openaiBaseUrl ?? '');
            setOpenaiModel(cfg.openaiModel ?? '');
            setActiveContainer(cfg.activeContainer ?? '');
            setServer({
                baseUrl: cfg.baseUrl ?? '',
                apiKey: cfg.apiKey ?? '',
                serverPath: cfg.serverPath ?? '',
                openaiApiKey: cfg.openaiApiKey ?? '',
                openaiBaseUrl: cfg.openaiBaseUrl ?? '',
                openaiModel: cfg.openaiModel ?? '',
                activeContainer: cfg.activeContainer ?? '',
            });
            setStatus(null);
            // Best-effort fetch of the managed-process status.
            fetch(API_URLS.health, { cache: 'no-store' })
                .then((r) => r.json().catch(() => ({})))
                .then((h) => h?.managed && setManaged(h.managed))
                .catch(() => { });
        }
        catch {
            setLoadErr(true);
        }
        finally {
            setLoading(false);
        }
    }
    useEffect(() => {
        if (!open)
            return;
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);
    // Declarative prefetch: once the API key is known, load the container list
    // automatically (no manual event wiring needed for the initial load).
    useEffect(() => {
        if (!open)
            return;
        if (!apiKey || !apiKey.trim())
            return;
        void loadContainers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, apiKey]);
    /**
     * Fetch available containers from the upstream server (cache-aware).
     * force: true always hits the network (used after creating a space);
     * otherwise skips while a fetch is in flight or the last successful fetch
     * is younger than CONTAINER_TTL_MS — reopening the dropdown is instant.
     */
    async function loadContainers(force = false) {
        if (containersInFlightRef.current)
            return;
        const isFresh = Date.now() - containersFetchedAtRef.current < CONTAINER_TTL_MS;
        if (!force && isFresh)
            return;
        containersInFlightRef.current = true;
        setContainersLoading(true);
        try {
            const res = await fetch(API_URLS.containers, { cache: 'no-store' });
            if (!res.ok) {
                setContainers([]);
                return;
            }
            const data = await res.json();
            const list = (data.containers ?? []).map((c) => ({
                tag: c.tag,
                staticCount: c.staticCount ?? 0,
                dynamicCount: c.dynamicCount ?? 0,
            }));
            setContainers(list);
            // Mark fresh only on a successful, non-empty response.
            if (list.length > 0)
                containersFetchedAtRef.current = Date.now();
            // If activeContainer is empty, auto-select the first one.
            if (!activeContainer.trim() && list.length > 0) {
                const first = list[0].tag;
                setActiveContainer(first);
                setServer((prev) => prev ? { ...prev, activeContainer: first } : prev);
            }
        }
        catch {
            // Upstream unreachable — show an empty list rather than stale data.
            setContainers([]);
        }
        finally {
            containersInFlightRef.current = false;
            setContainersLoading(false);
        }
    }
    /** Save only the activeContainer field (dedicated switch endpoint). */
    async function saveContainer(tag) {
        setActiveContainer(tag);
        setServer((prev) => prev ? { ...prev, activeContainer: tag } : prev);
        try {
            await fetch(API_URLS.activeContainer, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ containerTag: tag }),
            });
        }
        catch { /* best-effort: already updated locally; server learns on next settings save */ }
    }
    async function commit() {
        const patch = {};
        if (baseUrl.trim() !== (server?.baseUrl ?? ''))
            patch.baseUrl = baseUrl.trim();
        if (apiKey.trim() !== (server?.apiKey ?? ''))
            patch.apiKey = apiKey.trim();
        if (serverPath.trim() !== (server?.serverPath ?? ''))
            patch.serverPath = serverPath.trim();
        if (openaiApiKey.trim() !== (server?.openaiApiKey ?? ''))
            patch.openaiApiKey = openaiApiKey.trim();
        if (openaiBaseUrl.trim() !== (server?.openaiBaseUrl ?? ''))
            patch.openaiBaseUrl = openaiBaseUrl.trim();
        if (openaiModel.trim() !== (server?.openaiModel ?? ''))
            patch.openaiModel = openaiModel.trim();
        if (activeContainer.trim() !== ((server?.activeContainer ?? '').trim()))
            patch.activeContainer = activeContainer.trim();
        if (Object.keys(patch).length === 0)
            return;
        setSaving(true);
        setSaveFailed(false);
        setJustSaved(false);
        try {
            const apply = applyPatch ?? (async (p) => {
                const res = await fetch(API_URLS.config, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ patch: p }),
                });
                if (!res.ok) {
                    const body = await res.text();
                    return { ok: false, error: body.slice(0, 200) };
                }
                return { ok: true };
            });
            const outcome = await apply(patch);
            if (!outcome.ok) {
                setSaveFailed(true);
            }
            else {
                setServer((prev) => ({
                    ...(prev ?? { ...DEFAULT_EMPTY }),
                    ...patch,
                }));
                setJustSaved(true);
                setStatus({ kind: 'ok', text: t('saved') });
                // Config save reconciles the managed process — refresh its status.
                fetch(API_URLS.health, { cache: 'no-store' })
                    .then((r) => r.json().catch(() => ({})))
                    .then((h) => h?.managed && setManaged(h.managed))
                    .catch(() => { });
            }
        }
        catch {
            setSaveFailed(true);
        }
        finally {
            setSaving(false);
        }
    }
    async function runTest() {
        setTesting(true);
        setStatus({ kind: 'info', text: t('checking') });
        try {
            const res = await fetch(API_URLS.health, { cache: 'no-store' });
            const data = (await res.json().catch(() => ({})));
            if (data && data.managed)
                setManaged(data.managed);
            if (data && data.ok) {
                setStatus({ kind: 'ok', text: t('ok') + ' · ' + (data.baseUrl ?? '') });
            }
            else if (data && data.configured === false) {
                setStatus({ kind: 'err', text: t('emptyKey') });
            }
            else {
                setStatus({ kind: 'err', text: t('checkFailed') + ' · ' + (data?.error ?? 'HTTP ' + String(res.status)) });
            }
        }
        catch {
            setStatus({ kind: 'err', text: t('checkFailed') });
        }
        finally {
            setTesting(false);
        }
    }
    const mgtText = (m) => {
        if (!m)
            return null;
        switch (m.state) {
            case 'no-path': return t('mgtNoPath');
            case 'external': return t('mgtExternal');
            case 'running': return t('mgtRunning') + (m.pid ? ' · PID ' + m.pid : '');
            case 'starting': return t('mgtStarting');
            case 'stopped': return t('mgtStopped');
            case 'missing-exe': return t('mgtMissingExe');
            case 'error': return t('mgtError') + (m.error ? ' · ' + m.error : '');
            default: return m.state ?? '';
        }
    };
    return {
        // state
        open, loading, baseUrl, apiKey, serverPath, openaiApiKey, openaiBaseUrl,
        openaiModel, activeContainer, containers, containersLoading,
        creatingContainer, newContainerName, managed, server,
        saving, saveFailed, justSaved, testing, status, loadErr,
        dirty, mgtText,
        // actions
        setOpen, setBaseUrl, setApiKey, setServerPath, setOpenaiApiKey,
        setOpenaiBaseUrl, setOpenaiModel, setActiveContainer,
        setContainers, setContainersLoading, setCreatingContainer,
        setNewContainerName, setManaged, setSaving, setSaveFailed,
        setJustSaved, setTesting, setStatus, setLoadErr,
        load, loadContainers, saveContainer, commit, runTest,
    };
}
