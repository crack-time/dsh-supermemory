/**
 * Settings-dialog card for the "supermemory" namespace.
 *
 * Two fields (base URL + API key) plus a connection test. Reads and writes go
 * through the host half's /plugins/@crack/dsh-supermemory/api/config (and the
 * health probe for the test button); `applyPatch` is the slot host's write
 * channel, falling back to a plain fetch when absent.
 *
 * The card chrome mirrors the built-in plugin cards (PluginCard.module.css)
 * exactly like the skin card does: same DOM shape, same design tokens
 * (--dsw-alias-*), so it stays consistent with the shell / agent-loop /
 * web-search / wallpaper cards in both light and dark themes. The CSS is
 * embedded as a string and injected by `injectCardCss()` — no build-pipeline
 * changes needed (tsc strips CSS imports).
 */
import { useEffect, useRef, useState } from 'react';
import { CARD_LOCALE, type CardTextKey } from './card-locale.ts';

interface CardState {
    baseUrl: string;
    apiKey: string;
    serverPath: string;
    openaiApiKey: string;
    openaiBaseUrl: string;
    openaiModel: string;
    activeContainer: string;
}

interface ContainerInfo {
    tag: string;
    staticCount: number;
    dynamicCount: number;
}

interface ManagedStatus {
    enabled?: boolean;
    state?: string;
    pid?: number;
    exe?: string;
    error?: string;
    stderrTail?: string;
}

interface CardProps {
    /** Translation face injected by the slot host (keyed namespace). */
    t?: (key: CardTextKey) => string;
    applyPatch?: (patch: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
}

interface Status {
    kind: 'ok' | 'err' | 'info';
    text: string;
}

const CONFIG_URL = '/plugins/@crack/dsh-supermemory/api/config';
const CONTAINER_SWITCH_URL = '/plugins/@crack/dsh-supermemory/api/active-container';
const HEALTH_URL = '/plugins/@crack/dsh-supermemory/api/health';
const DEFAULT_BASE_URL = 'http://localhost:6767';


const cn = (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(' ');

function Chevron({ className }: { className?: string }) {
    return (
        <svg
            width={14}
            height={14}
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className={className}
        >
            <path d="M6 10.75 L2.25 6.5 M6 10.75 L9.75 6.5" />
        </svg>
    );
}

export function SupermemorySettingsCard(props: CardProps) {
    const { t, applyPatch } = props;
    const lang: 'zh' | 'en' =
        typeof navigator !== 'undefined' && navigator.language && navigator.language.toLowerCase().startsWith('zh')
            ? 'zh'
            : 'en';
    const txt = (key: CardTextKey): string =>
        typeof t === 'function' ? t(key) : (CARD_LOCALE[lang][key] ?? key);

    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [baseUrl, setBaseUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [serverPath, setServerPath] = useState('');
    const [openaiApiKey, setOpenaiApiKey] = useState('');
    const [openaiBaseUrl, setOpenaiBaseUrl] = useState('');
    const [openaiModel, setOpenaiModel] = useState('');
    const [activeContainer, setActiveContainer] = useState('');
    const [containers, setContainers] = useState<ContainerInfo[]>([]);
    const [containersLoading, setContainersLoading] = useState(false);
    const [creatingContainer, setCreatingContainer] = useState(false);
    const [newContainerName, setNewContainerName] = useState('');
    const [managed, setManaged] = useState<ManagedStatus | null>(null);
    const [server, setServer] = useState<CardState | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveFailed, setSaveFailed] = useState(false);
    const [justSaved, setJustSaved] = useState(false);
    const [testing, setTesting] = useState(false);
    const [status, setStatus] = useState<Status | null>(null);
    const [loadErr, setLoadErr] = useState(false);
    // Container-fetch cache: data is considered fresh for CONTAINER_TTL_MS.
    // The in-flight guard is a ref (not state) so it is synchronous —
    // near-simultaneous focus + click cannot both start a fetch.
    const CONTAINER_TTL_MS = 60_000;
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
            const res = await fetch(CONFIG_URL, { cache: 'no-store' });
            if (!res.ok) { setLoadErr(true); return; }
            const cfg = (await res.json()) as CardState;
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
            fetch(HEALTH_URL, { cache: 'no-store' })
                .then((r) => r.json().catch(() => ({})))
                .then((h) => h?.managed && setManaged(h.managed as ManagedStatus))
                .catch(() => { /* status is optional */ });
        }
        catch {
            setLoadErr(true);
        }
        finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (!open) return;
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Declarative prefetch: once the API key is known, load the container list
    // automatically (no manual event wiring needed for the initial load).
    useEffect(() => {
        if (!open) return;
        if (!apiKey || !apiKey.trim()) return;
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
        if (containersInFlightRef.current) return;
        const isFresh = Date.now() - containersFetchedAtRef.current < CONTAINER_TTL_MS;
        if (!force && isFresh) return;
        containersInFlightRef.current = true;
        setContainersLoading(true);
        try {
            const CONTAINERS_URL = '/plugins/@crack/dsh-supermemory/api/containers';
            const res = await fetch(CONTAINERS_URL, { cache: 'no-store' });
            if (!res.ok) { setContainers([]); return; }
            const data = await res.json() as { containers?: Array<{ tag: string; staticCount?: number; dynamicCount?: number }> };
            const list = (data.containers ?? []).map((c) => ({
                tag: c.tag,
                staticCount: c.staticCount ?? 0,
                dynamicCount: c.dynamicCount ?? 0,
            }));
            setContainers(list);
            // Mark fresh only on a successful, non-empty response.
            if (list.length > 0) containersFetchedAtRef.current = Date.now();
            // If activeContainer is empty, auto-select the first one.
            if (!activeContainer.trim() && list.length > 0) {
                const first = list[0]!.tag;
                setActiveContainer(first);
                setServer((prev) => prev ? { ...prev, activeContainer: first } : prev);
            }
        } catch {
            setContainers([]);
        } finally {
            containersInFlightRef.current = false;
            setContainersLoading(false);
        }
    }

    /** Save only the activeContainer field (dedicated switch endpoint). */
    async function saveContainer(tag: string) {
        setActiveContainer(tag);
        setServer((prev) => prev ? { ...prev, activeContainer: tag } : prev);
        try {
            await fetch(CONTAINER_SWITCH_URL, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ containerTag: tag }),
            });
        } catch { /* best-effort */ }
    }

    async function commit() {
        const patch: Record<string, unknown> = {};
        if (baseUrl.trim() !== (server?.baseUrl ?? '')) patch.baseUrl = baseUrl.trim();
        if (apiKey.trim() !== (server?.apiKey ?? '')) patch.apiKey = apiKey.trim();
        if (serverPath.trim() !== (server?.serverPath ?? '')) patch.serverPath = serverPath.trim();
        if (openaiApiKey.trim() !== (server?.openaiApiKey ?? '')) patch.openaiApiKey = openaiApiKey.trim();
        if (openaiBaseUrl.trim() !== (server?.openaiBaseUrl ?? '')) patch.openaiBaseUrl = openaiBaseUrl.trim();
        if (openaiModel.trim() !== (server?.openaiModel ?? '')) patch.openaiModel = openaiModel.trim();
        if (activeContainer.trim() !== ((server?.activeContainer ?? '').trim())) patch.activeContainer = activeContainer.trim();
        if (Object.keys(patch).length === 0) return;
        setSaving(true);
        setSaveFailed(false);
        setJustSaved(false);
        try {
            const apply = applyPatch ?? (async (p: Record<string, unknown>) => {
                const res = await fetch(CONFIG_URL, {
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
                    ...(prev ?? {
                        baseUrl: '',
                        apiKey: '',
                        serverPath: '',
                        openaiApiKey: '',
                        openaiBaseUrl: '',
                        openaiModel: '',
                        activeContainer: '',
                    }),
                    ...patch,
                }));
                setJustSaved(true);
                setStatus({ kind: 'ok', text: txt('saved') });
                // Config save reconciles the managed process — refresh its status.
                fetch(HEALTH_URL, { cache: 'no-store' })
                    .then((r) => r.json().catch(() => ({})))
                    .then((h) => h?.managed && setManaged(h.managed as ManagedStatus))
                    .catch(() => { /* optional */ });
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
        setStatus({ kind: 'info', text: txt('checking') });
        try {
            const res = await fetch(HEALTH_URL, { cache: 'no-store' });
            const data = (await res.json().catch(() => ({}))) as {
                ok?: boolean;
                configured?: boolean;
                baseUrl?: string;
                error?: string;
                managed?: ManagedStatus;
            };
            if (data && data.managed) setManaged(data.managed);
            if (data && data.ok) {
                setStatus({ kind: 'ok', text: txt('ok') + ' · ' + (data.baseUrl ?? '') });
            }
            else if (data && data.configured === false) {
                setStatus({ kind: 'err', text: txt('emptyKey') });
            }
            else {
                setStatus({ kind: 'err', text: txt('checkFailed') + ' · ' + (data?.error ?? 'HTTP ' + String(res.status)) });
            }
        }
        catch {
            setStatus({ kind: 'err', text: txt('checkFailed') });
        }
        finally {
            setTesting(false);
        }
    }

    const mgtText = (m: ManagedStatus | null): string | null => {
        if (!m) return null;
        switch (m.state) {
            case 'no-path': return txt('mgtNoPath');
            case 'external': return txt('mgtExternal');
            case 'running': return txt('mgtRunning') + (m.pid ? ' · PID ' + m.pid : '');
            case 'starting': return txt('mgtStarting');
            case 'stopped': return txt('mgtStopped');
            case 'missing-exe': return txt('mgtMissingExe');
            case 'error': return txt('mgtError') + (m.error ? ' · ' + m.error : '');
            default: return m.state ?? '';
        }
    };

    const title = txt('title');
    const statusText = status ? status.text : loadErr ? txt('loadFailed') : null;

    return (
        <li
            data-supermemory-settings
            className={cn('sm-settings-card', open && 'sm-settings-card-open')}
        >
            <button
                type="button"
                className="sm-settings-header"
                aria-expanded={open}
                aria-label={`${txt(open ? 'collapse' : 'expand')}: ${title}`}
                onClick={() => setOpen((v) => !v)}
            >
                <span className="sm-settings-headText">
                    <span className="sm-settings-name">{title}</span>
                    <span className="sm-settings-description">{txt('description')}</span>
                </span>
                {dirty ? <span className="sm-settings-pending">{txt('unsaved')}</span> : null}
                <Chevron className={cn('sm-settings-chevron', open && 'sm-settings-chevron-open')} />
            </button>
            {open ? (
                <div className="sm-settings-body">
                    <label className="sm-settings-row">
                        <span className="sm-settings-label">{txt('baseUrl')}</span>
                        <input
                            type="text"
                            value={baseUrl}
                            placeholder={DEFAULT_BASE_URL}
                            spellCheck={false}
                            onChange={(e) => setBaseUrl(e.target.value)}
                        />
                        <span className="sm-settings-hint">{txt('baseUrlHint')}</span>
                    </label>
                    <label className="sm-settings-row">
                        <span className="sm-settings-label">{txt('apiKey')}</span>
                        <input
                            type="password"
                            value={apiKey}
                            placeholder="sm_..."
                            spellCheck={false}
                            autoComplete="off"
                            onChange={(e) => setApiKey(e.target.value)}
                        />
                        <span className="sm-settings-hint">{txt('apiKeyHint')}</span>
                    </label>
                    <label className="sm-settings-row">
                        <span className="sm-settings-label">{txt('serverPath')}</span>
                        <input
                            type="text"
                            value={serverPath}
                            placeholder="C:\Users\crack\Supermemory\supermemory-server-windows-x64.exe"
                            spellCheck={false}
                            onChange={(e) => setServerPath(e.target.value)}
                        />
                        <span className="sm-settings-hint">{txt('serverPathHint')}</span>
                    </label>
                    <label className="sm-settings-row">
                        <span className="sm-settings-label">{txt('openaiApiKey')}</span>
                        <input
                            type="password"
                            value={openaiApiKey}
                            spellCheck={false}
                            autoComplete="off"
                            onChange={(e) => setOpenaiApiKey(e.target.value)}
                        />
                    </label>
                    <label className="sm-settings-row">
                        <span className="sm-settings-label">{txt('openaiBaseUrl')}</span>
                        <input
                            type="text"
                            value={openaiBaseUrl}
                            placeholder="https://token-plan-cn.xiaomimimo.com/v1"
                            spellCheck={false}
                            onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                        />
                    </label>
                    <label className="sm-settings-row">
                        <span className="sm-settings-label">{txt('openaiModel')}</span>
                        <input
                            type="text"
                            value={openaiModel}
                            placeholder="mimo-v2.5"
                            spellCheck={false}
                            onChange={(e) => setOpenaiModel(e.target.value)}
                        />
                    </label>
                    <label className="sm-settings-row">
                        <span className="sm-settings-label">{txt('activeContainer')}</span>
                        <div className="sm-settings-container-row">
                            <select
                                className="sm-settings-select"
                                value={creatingContainer ? '__new__' : activeContainer}
                                onFocus={() => void loadContainers()}
                                onClick={() => void loadContainers()}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === '__new__') {
                                        setCreatingContainer(true);
                                        setNewContainerName('');
                                    } else {
                                        setCreatingContainer(false);
                                        void saveContainer(val);
                                    }
                                }}
                                disabled={containersLoading && containers.length === 0}
                            >
                                {containersLoading ? (
                                    <option value="">{txt('loadingContainers')}</option>
                                ) : containers.length === 0 ? (
                                    <option value="">{txt('noContainers')}</option>
                                ) : (
                                    containers.map((c) => (
                                        <option key={c.tag} value={c.tag}>
                                            {c.tag} — {txt('containerStats').replace('{static}', String(c.staticCount)).replace('{dynamic}', String(c.dynamicCount))}
                                        </option>
                                    ))
                                )}
                                <option value="__new__">{txt('createNew')}</option>
                            </select>
                            {creatingContainer ? (
                                <div className="sm-settings-container-new">
                                    <input
                                        type="text"
                                        className="sm-settings-input-inline"
                                        value={newContainerName}
                                        placeholder={txt('createPlaceholder')}
                                        spellCheck={false}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && newContainerName.trim()) {
                                                const tag = newContainerName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
                                                void saveContainer(tag);
                                                setCreatingContainer(false);
                                                setNewContainerName('');
                                                setTimeout(() => void loadContainers(true), 600);
                                            }
                                            if (e.key === 'Escape') {
                                                setCreatingContainer(false);
                                                setNewContainerName('');
                                            }
                                        }}
                                        onChange={(e) => setNewContainerName(e.target.value)}
                                        autoFocus
                                    />
                                    <button
                                        type="button"
                                        className="sm-settings-test"
                                        disabled={!newContainerName.trim()}
                                        onClick={() => {
                                            if (!newContainerName.trim()) return;
                                            const tag = newContainerName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
                                            void saveContainer(tag);
                                            setCreatingContainer(false);
                                            setNewContainerName('');
                                            setTimeout(() => void loadContainers(true), 600);
                                        }}
                                    >
                                        ✓
                                    </button>
                                    <button
                                        type="button"
                                        className="sm-settings-discard"
                                        onClick={() => { setCreatingContainer(false); setNewContainerName(''); }}
                                    >
                                        ✕
                                    </button>
                                </div>
                            ) : null}
                        </div>
                        <span className="sm-settings-hint">{txt('activeContainerHint')}</span>
                    </label>
                    <div className="sm-settings-serverrow">
                        <span
                            className={cn(
                                'sm-settings-status',
                                managed?.state === 'running' && 'sm-settings-status-ok',
                                (managed?.state === 'error' || managed?.state === 'missing-exe' || managed?.state === 'no-path') && 'sm-settings-status-err',
                            )}
                        >
                            {txt('managedStatus')}: {mgtText(managed) ?? '—'}
                        </span>
                    </div>
                    <div className="sm-settings-footer">
                        {statusText ? (
                            <span
                                className={cn(
                                    'sm-settings-status',
                                    status?.kind === 'ok' && 'sm-settings-status-ok',
                                    status?.kind === 'err' && 'sm-settings-status-err',
                                )}
                                role="status"
                            >
                                {statusText}
                            </span>
                        ) : saveFailed ? (
                            <p className="sm-settings-failed" role="status">
                                {txt('saveFailed')}
                            </p>
                        ) : justSaved ? (
                            <span className="sm-settings-status sm-settings-status-ok" role="status">
                                {txt('saved')}
                            </span>
                        ) : null}
                        <button
                            type="button"
                            className="sm-settings-test"
                            disabled={testing}
                            onClick={() => void runTest()}
                        >
                            {testing ? txt('testing') : txt('test')}
                        </button>
                        <button
                            type="button"
                            className="sm-settings-discard"
                            disabled={!dirty || saving}
                            onClick={() => {
                                setBaseUrl(server?.baseUrl ?? '');
                                setApiKey(server?.apiKey ?? '');
                                setServerPath(server?.serverPath ?? '');
                                setOpenaiApiKey(server?.openaiApiKey ?? '');
                                setOpenaiBaseUrl(server?.openaiBaseUrl ?? '');
                                setOpenaiModel(server?.openaiModel ?? '');
                                setActiveContainer(server?.activeContainer ?? '');
                                setSaveFailed(false);
                            }}
                        >
                            {txt('discard')}
                        </button>
                        <button
                            type="button"
                            className="sm-settings-save"
                            disabled={!dirty || saving}
                            onClick={() => void commit()}
                        >
                            {saving ? txt('saving') : txt('save')}
                        </button>
                    </div>
                </div>
            ) : null}
        </li>
    );
}
