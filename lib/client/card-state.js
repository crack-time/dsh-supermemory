/**
 * Settings-card state + business logic, extracted from card.tsx so the
 * component keeps only JSX and the hook stays testable on its own.
 *
 * The hook owns: config IO (load/save/commit), connection test, and every
 * piece of field state the card renders. It takes the translation function
 * and the patch channel as dependencies (injected by the slot host),
 * mirroring CardProps.
 */
import { useEffect, useState } from 'react';
import { API_URLS } from './api.js';
const DEFAULT_EMPTY = {
    baseUrl: '',
    apiKey: '',
    serverPath: '',
    openaiApiKey: '',
    openaiBaseUrl: '',
    openaiModel: '',
    activeContainer: '',
    recallEnabled: true,
    recallTopK: 4,
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
    const [recallEnabled, setRecallEnabled] = useState(true);
    const [recallTopK, setRecallTopK] = useState(4);
    const [managed, setManaged] = useState(null);
    const [server, setServer] = useState(null);
    const [saving, setSaving] = useState(false);
    const [saveFailed, setSaveFailed] = useState(false);
    const [justSaved, setJustSaved] = useState(false);
    const [testing, setTesting] = useState(false);
    const [status, setStatus] = useState(null);
    const [loadErr, setLoadErr] = useState(false);
    const dirty = server !== null &&
        (baseUrl.trim() !== server.baseUrl ||
            apiKey.trim() !== server.apiKey ||
            serverPath.trim() !== server.serverPath ||
            openaiApiKey.trim() !== server.openaiApiKey ||
            openaiBaseUrl.trim() !== server.openaiBaseUrl ||
            openaiModel.trim() !== server.openaiModel ||
            recallEnabled !== !!server.recallEnabled ||
            recallTopK !== (server.recallTopK ?? 4));
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
            setRecallEnabled(cfg.recallEnabled !== false);
            setRecallTopK(typeof cfg.recallTopK === 'number' ? cfg.recallTopK : 4);
            setServer({
                baseUrl: cfg.baseUrl ?? '',
                apiKey: cfg.apiKey ?? '',
                serverPath: cfg.serverPath ?? '',
                openaiApiKey: cfg.openaiApiKey ?? '',
                openaiBaseUrl: cfg.openaiBaseUrl ?? '',
                openaiModel: cfg.openaiModel ?? '',
                activeContainer: cfg.activeContainer ?? '',
                recallEnabled: cfg.recallEnabled !== false,
                recallTopK: typeof cfg.recallTopK === 'number' ? cfg.recallTopK : 4,
            });
            setStatus(null);
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
    }, [open]);
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
        if (recallEnabled !== !!server?.recallEnabled)
            patch.recallEnabled = recallEnabled;
        if (recallTopK !== (server?.recallTopK ?? 4))
            patch.recallTopK = recallTopK;
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
        open, loading, baseUrl, apiKey, serverPath, openaiApiKey, openaiBaseUrl,
        openaiModel, recallEnabled, recallTopK, managed, server,
        saving, saveFailed, justSaved, testing, status, loadErr,
        dirty, mgtText,
        setOpen, setBaseUrl, setApiKey, setServerPath, setOpenaiApiKey,
        setOpenaiBaseUrl, setOpenaiModel, setRecallEnabled, setRecallTopK,
        setManaged, setSaving, setSaveFailed, setJustSaved, setTesting,
        setStatus, setLoadErr,
        load, commit, runTest,
    };
}
