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
import { useEffect, useState } from 'react';

/** Locale dictionary for the card. */
export const CARD_LOCALE = {
    zh: {
        title: 'Supermemory 代理',
        description: '本地记忆服务接入 dsh',
        baseUrl: '服务地址',
        baseUrlHint: '留空使用 http://localhost:6767',
        apiKey: 'API Key',
        apiKeyHint: '在 localhost:6767 首页可查看',
        show: '显示',
        hide: '隐藏',
        save: '保存',
        saving: '保存中…',
        discard: '放弃修改',
        test: '测试连接',
        testing: '测试中…',
        unsaved: '未保存',
        saveFailed: '保存失败，请重试',
        saved: '已保存',
        expand: '展开',
        collapse: '折叠',
        checkFailed: '测试失败',
        ok: '可用',
        checking: '检查中…',
        loadFailed: '读取配置失败',
        emptyKey: '未配置 API Key',
        serverPath: '服务器可执行文件路径',
        serverPathHint: '例：C:\\Users\\crack\\Supermemory\\supermemory-server-windows-x64.exe',
        openaiApiKey: 'OPENAI_API_KEY（记忆引擎模型密钥）',
        openaiBaseUrl: 'OPENAI_BASE_URL',
        openaiModel: 'OPENAI_MODEL',
        managedStatus: '托管状态',
        mgtNoPath: '请先填写服务器可执行文件路径并保存',
        mgtExternal: '已在运行（外部实例，未重复拉起）',
        mgtRunning: '托管运行中',
        mgtStarting: '启动中…',
        mgtStopped: '未启动',
        mgtMissingExe: '可执行文件缺失',
        mgtError: '启动失败',
        serverStart: '启动/重启托管',
        serverStop: '停止托管',
        serverBusy: '处理中…',
        serverActionFailed: '操作失败',
    },
    en: {
        title: 'Supermemory proxy',
        description: 'Local memory server access via dsh',
        baseUrl: 'Base URL',
        baseUrlHint: 'Leave empty for http://localhost:6767',
        apiKey: 'API Key',
        apiKeyHint: 'Shown on the localhost:6767 dashboard',
        show: 'Show',
        hide: 'Hide',
        save: 'Save',
        saving: 'Saving…',
        discard: 'Discard',
        test: 'Test',
        testing: 'Testing…',
        unsaved: 'Unsaved',
        saveFailed: 'Save failed, retry',
        saved: 'Saved',
        expand: 'Expand',
        collapse: 'Collapse',
        checkFailed: 'Test failed',
        ok: 'OK',
        checking: 'Checking…',
        loadFailed: 'Failed to read configuration',
        emptyKey: 'API key not configured',
        serverPath: 'Server executable path',
        serverPathHint: 'e.g. C:\\Users\\crack\\Supermemory\\supermemory-server-windows-x64.exe',
        openaiApiKey: 'OPENAI_API_KEY (memory-engine model key)',
        openaiBaseUrl: 'OPENAI_BASE_URL',
        openaiModel: 'OPENAI_MODEL',
        managedStatus: 'Managed state',
        mgtNoPath: 'Set the server executable path and save first',
        mgtExternal: 'Already running (external instance, not re-launched)',
        mgtRunning: 'Managed & running',
        mgtStarting: 'Starting…',
        mgtStopped: 'Not running',
        mgtMissingExe: 'Executable missing',
        mgtError: 'Failed to start',
        serverStart: 'Start / restart managed',
        serverStop: 'Stop managed',
        serverBusy: 'Working…',
        serverActionFailed: 'Action failed',
    },
};

type CardTextKey = keyof typeof CARD_LOCALE.zh;

interface CardState {
    baseUrl: string;
    apiKey: string;
    serverPath: string;
    openaiApiKey: string;
    openaiBaseUrl: string;
    openaiModel: string;
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
    t?: (key: string) => string;
    applyPatch?: (patch: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
}

interface Status {
    kind: 'ok' | 'err' | 'info';
    text: string;
}

const CONFIG_URL = '/plugins/@crack/dsh-supermemory/api/config';
const HEALTH_URL = '/plugins/@crack/dsh-supermemory/api/health';
const DEFAULT_BASE_URL = 'http://localhost:6767';

/**
 * Card styles — same values as the built-in PluginCard (via the skin card's
 * recreation of PluginCard.module.css), keyed off [data-supermemory-settings]
 * so they never leak outside this card.
 */
export const CARD_CSS = `
[data-supermemory-settings].sm-settings-card {
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-3);
  border-radius: 12px;
  list-style: none;
  transition: border-color 0.16s, background 0.16s;
}
[data-supermemory-settings].sm-settings-card:hover {
  border-color: var(--dsw-alias-label-dimmed);
}
[data-supermemory-settings].sm-settings-card-open {
  background: var(--dsw-alias-bg-layer-2);
  border-color: var(--dsw-alias-label-dimmed);
}
[data-supermemory-settings] .sm-settings-header {
  appearance: none;
  width: 100%;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  background: 0 0;
  border: 0;
  border-radius: 12px;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  display: flex;
}
[data-supermemory-settings] .sm-settings-header:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -2px;
}
[data-supermemory-settings] .sm-settings-headText {
  flex-direction: column;
  flex: 1;
  gap: 4px;
  min-width: 0;
  display: flex;
}
[data-supermemory-settings] .sm-settings-name {
  color: var(--dsw-alias-label-primary);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
}
[data-supermemory-settings] .sm-settings-description {
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 1.5;
}
[data-supermemory-settings] .sm-settings-chevron {
  color: var(--dsw-alias-label-tertiary);
  flex: none;
  transition: transform 0.16s;
}
[data-supermemory-settings] .sm-settings-chevron-open {
  transform: rotate(180deg);
}
[data-supermemory-settings] .sm-settings-pending {
  white-space: nowrap;
  background: var(--dsw-alias-bg-module-platform, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-secondary);
  border-radius: 999px;
  flex: none;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 500;
  line-height: 17px;
}
[data-supermemory-settings] .sm-settings-body {
  border-top: 1px solid var(--dsw-alias-border-l2);
  margin: 0 16px;
  padding-bottom: 8px;
  flex-direction: column;
  gap: 12px;
  display: flex;
}
[data-supermemory-settings] .sm-settings-row {
  flex-direction: column;
  gap: 4px;
  display: flex;
}
[data-supermemory-settings] .sm-settings-label {
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
}
[data-supermemory-settings] input[type="text"],
[data-supermemory-settings] input[type="password"] {
  box-sizing: border-box;
  width: 100%;
  height: 34px;
  padding: 6px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
}
[data-supermemory-settings] .sm-settings-hint {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}
[data-supermemory-settings] .sm-settings-footer {
  border-top: 1px solid var(--dsw-alias-border-l2);
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding: 12px 0 4px;
  display: flex;
}
[data-supermemory-settings] .sm-settings-status {
  min-width: 0;
  flex: 1;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
  overflow-wrap: anywhere;
}
[data-supermemory-settings] .sm-settings-status-ok {
  color: var(--dsw-alias-state-success-primary);
}
[data-supermemory-settings] .sm-settings-status-err {
  color: var(--dsw-alias-state-error-primary);
}
[data-supermemory-settings] .sm-settings-failed {
  min-width: 0;
  color: var(--dsw-alias-state-error-primary);
  flex: 1;
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}
[data-supermemory-settings] .sm-settings-test,
[data-supermemory-settings] .sm-settings-discard,
[data-supermemory-settings] .sm-settings-save {
  appearance: none;
  font: inherit;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 5px 14px;
  font-size: 13px;
  line-height: 1.5;
}
[data-supermemory-settings] .sm-settings-test,
[data-supermemory-settings] .sm-settings-discard {
  border-color: var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  background: 0 0;
}
[data-supermemory-settings] .sm-settings-save {
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-button-primary-invert);
}
[data-supermemory-settings] .sm-settings-test:disabled,
[data-supermemory-settings] .sm-settings-save:disabled,
[data-supermemory-settings] .sm-settings-discard:disabled {
  opacity: 0.55;
  cursor: default;
}
[data-supermemory-settings] .sm-settings-check {
  flex-direction: row;
  align-items: flex-start;
  gap: 8px;
}
[data-supermemory-settings] .sm-settings-check input[type="checkbox"] {
  width: auto;
  height: auto;
  margin-top: 3px;
  accent-color: var(--dsw-alias-brand-primary);
  cursor: pointer;
}
[data-supermemory-settings] .sm-settings-hint.sm-settings-block {
  display: block;
  margin-top: 2px;
}
[data-supermemory-settings] .sm-settings-serverrow {
  align-items: center;
  gap: 8px;
  display: flex;
  flex-wrap: wrap;
}
`;

let cssInjected = false;
/** Inject the card styles once (idempotent; safe to call from apply()). */
export function injectCardCss(): void {
    if (cssInjected || typeof document === 'undefined') return;
    cssInjected = true;
    try {
        const style = document.createElement('style');
        style.dataset.plugin = 'dsh-supermemory';
        style.textContent = CARD_CSS;
        document.head.appendChild(style);
    } catch { /* document not ready — card markup would fail anyway */ }
}

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
    const [managed, setManaged] = useState<ManagedStatus | null>(null);
    const [serverBusy, setServerBusy] = useState(false);
    const [serverActionErr, setServerActionErr] = useState(false);
    const [server, setServer] = useState<CardState | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveFailed, setSaveFailed] = useState(false);
    const [justSaved, setJustSaved] = useState(false);
    const [testing, setTesting] = useState(false);
    const [status, setStatus] = useState<Status | null>(null);
    const [loadErr, setLoadErr] = useState(false);

    const dirty = server !== null &&
        (baseUrl.trim() !== server.baseUrl ||
            apiKey.trim() !== server.apiKey ||
            serverPath.trim() !== server.serverPath ||
            openaiApiKey.trim() !== server.openaiApiKey ||
            openaiBaseUrl.trim() !== server.openaiBaseUrl ||
            openaiModel.trim() !== server.openaiModel);

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
            setServer({
                baseUrl: cfg.baseUrl ?? '',
                apiKey: cfg.apiKey ?? '',
                serverPath: cfg.serverPath ?? '',
                openaiApiKey: cfg.openaiApiKey ?? '',
                openaiBaseUrl: cfg.openaiBaseUrl ?? '',
                openaiModel: cfg.openaiModel ?? '',
            });
            setServerActionErr(false);
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

    async function commit() {
        const patch: Record<string, unknown> = {};
        if (baseUrl.trim() !== (server?.baseUrl ?? '')) patch.baseUrl = baseUrl.trim();
        if (apiKey.trim() !== (server?.apiKey ?? '')) patch.apiKey = apiKey.trim();
        if (serverPath.trim() !== (server?.serverPath ?? '')) patch.serverPath = serverPath.trim();
        if (openaiApiKey.trim() !== (server?.openaiApiKey ?? '')) patch.openaiApiKey = openaiApiKey.trim();
        if (openaiBaseUrl.trim() !== (server?.openaiBaseUrl ?? '')) patch.openaiBaseUrl = openaiBaseUrl.trim();
        if (openaiModel.trim() !== (server?.openaiModel ?? '')) patch.openaiModel = openaiModel.trim();
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
            };
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

    async function serverAction(which: 'start' | 'stop') {
        setServerBusy(true);
        setServerActionErr(false);
        setStatus(null);
        try {
            const res = await fetch(CONFIG_URL.replace('/config', '/server/' + which), { method: 'POST' });
            const data = (await res.json().catch(() => ({}))) as { ok?: boolean; managed?: ManagedStatus };
            if (!res.ok || data.ok === false) setServerActionErr(true);
            if (data.managed) setManaged(data.managed);
        }
        catch {
            setServerActionErr(true);
        }
        finally {
            setServerBusy(false);
        }
    }

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
                        <button
                            type="button"
                            className="sm-settings-test"
                            disabled={serverBusy}
                            onClick={() => void serverAction('start')}
                        >
                            {serverBusy ? txt('serverBusy') : txt('serverStart')}
                        </button>
                        <button
                            type="button"
                            className="sm-settings-test"
                            disabled={serverBusy}
                            onClick={() => void serverAction('stop')}
                        >
                            {serverBusy ? txt('serverBusy') : txt('serverStop')}
                        </button>
                    </div>
                    {serverActionErr ? <p className="sm-settings-failed" role="status">{txt('serverActionFailed')}</p> : null}
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
                                setSaveFailed(false);
                                setServerActionErr(false);
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
