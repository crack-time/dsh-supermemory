/**
 * Settings-dialog card for the "supermemory" namespace — JSX only.
 *
 * Fields: base URL, API key, managed server + OpenAI settings and the active
 * memory-space dropdown (create/switch). All state and IO live in the
 * useSupermemoryCard hook (card-state.ts); locale in card-locale.ts; CSS in
 * card-css.ts — the component stays focused on rendering.
 */
import { CARD_LOCALE, type CardTextKey } from './card-locale.ts';
import { useSupermemoryCard } from './card-state.ts';

export type { ManagedStatus, Status, CardState } from './card-state.ts';

/** Props consumed by the card component (translation + patch channel). */
export interface CardProps {
    t?: (key: CardTextKey) => string;
    applyPatch?: (patch: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
}

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

    const {
        open, baseUrl, apiKey, serverPath, openaiApiKey, openaiBaseUrl,
        openaiModel, recallEnabled, recallTopK, recallThreshold, managed, server,
        saving, saveFailed, justSaved, testing, status, loadErr,
        dirty, mgtText,
        setOpen, setBaseUrl, setApiKey, setServerPath, setOpenaiApiKey,
        setOpenaiBaseUrl, setOpenaiModel, setRecallEnabled, setRecallTopK,
        setRecallThreshold,
        setSaveFailed, commit, runTest,
    } = useSupermemoryCard({ t: txt, applyPatch });

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
                            placeholder="C:\\Users\\crack\\Supermemory\\supermemory-server-windows-x64.exe"
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

                    <label className="sm-settings-row sm-settings-check">
                        <span className="sm-settings-label">{txt('recallEnabled')}</span>
                        <input
                            type="checkbox"
                            checked={recallEnabled}
                            onChange={(e) => setRecallEnabled(e.target.checked)}
                        />
                        <span className="sm-settings-hint">{txt('recallEnabledHint')}</span>
                    </label>
                    <label className="sm-settings-row">
                        <span className="sm-settings-label">{txt('recallTopK')}</span>
                        <input
                            type="number"
                            min={1}
                            max={10}
                            step={1}
                            value={recallTopK}
                            onChange={(e) => setRecallTopK(Number(e.target.value))}
                        />
                        <span className="sm-settings-hint">{txt('recallTopKHint')}</span>
                    </label>
                    <label className="sm-settings-row">
                        <span className="sm-settings-label">{txt('recallThreshold')}</span>
                        <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.05}
                            value={recallThreshold}
                            onChange={(e) => setRecallThreshold(Number(e.target.value))}
                        />
                        <span className="sm-settings-hint">{txt('recallThresholdHint')}</span>
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
