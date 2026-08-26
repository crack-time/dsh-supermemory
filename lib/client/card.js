import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Settings-dialog card for the "supermemory" namespace — JSX only.
 *
 * Fields: base URL, API key, managed server + OpenAI settings and the active
 * memory-space dropdown (create/switch). All state and IO live in the
 * useSupermemoryCard hook (card-state.ts); locale in card-locale.ts; CSS in
 * card-css.ts — the component stays focused on rendering.
 */
import { CARD_LOCALE } from './card-locale.js';
import { useSupermemoryCard } from './card-state.js';
const DEFAULT_BASE_URL = 'http://localhost:6767';
const cn = (...classes) => classes.filter(Boolean).join(' ');
function Chevron({ className }) {
    return (_jsx("svg", { width: 14, height: 14, viewBox: "0 0 12 12", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, className: className, children: _jsx("path", { d: "M6 10.75 L2.25 6.5 M6 10.75 L9.75 6.5" }) }));
}
export function SupermemorySettingsCard(props) {
    const { t, applyPatch } = props;
    const lang = typeof navigator !== 'undefined' && navigator.language && navigator.language.toLowerCase().startsWith('zh')
        ? 'zh'
        : 'en';
    const txt = (key) => typeof t === 'function' ? t(key) : (CARD_LOCALE[lang][key] ?? key);
    const { open, baseUrl, apiKey, serverPath, openaiApiKey, openaiBaseUrl, openaiModel, activeContainer, containers, containersLoading, creatingContainer, newContainerName, managed, server, saving, saveFailed, justSaved, testing, status, loadErr, dirty, mgtText, setOpen, setBaseUrl, setApiKey, setServerPath, setOpenaiApiKey, setOpenaiBaseUrl, setOpenaiModel, setActiveContainer, setCreatingContainer, setNewContainerName, setSaveFailed, loadContainers, saveContainer, commit, runTest, } = useSupermemoryCard({ t: txt, applyPatch });
    const title = txt('title');
    const statusText = status ? status.text : loadErr ? txt('loadFailed') : null;
    return (_jsxs("li", { "data-supermemory-settings": true, className: cn('sm-settings-card', open && 'sm-settings-card-open'), children: [_jsxs("button", { type: "button", className: "sm-settings-header", "aria-expanded": open, "aria-label": `${txt(open ? 'collapse' : 'expand')}: ${title}`, onClick: () => setOpen((v) => !v), children: [_jsxs("span", { className: "sm-settings-headText", children: [_jsx("span", { className: "sm-settings-name", children: title }), _jsx("span", { className: "sm-settings-description", children: txt('description') })] }), dirty ? _jsx("span", { className: "sm-settings-pending", children: txt('unsaved') }) : null, _jsx(Chevron, { className: cn('sm-settings-chevron', open && 'sm-settings-chevron-open') })] }), open ? (_jsxs("div", { className: "sm-settings-body", children: [_jsxs("label", { className: "sm-settings-row", children: [_jsx("span", { className: "sm-settings-label", children: txt('baseUrl') }), _jsx("input", { type: "text", value: baseUrl, placeholder: DEFAULT_BASE_URL, spellCheck: false, onChange: (e) => setBaseUrl(e.target.value) }), _jsx("span", { className: "sm-settings-hint", children: txt('baseUrlHint') })] }), _jsxs("label", { className: "sm-settings-row", children: [_jsx("span", { className: "sm-settings-label", children: txt('apiKey') }), _jsx("input", { type: "password", value: apiKey, placeholder: "sm_...", spellCheck: false, autoComplete: "off", onChange: (e) => setApiKey(e.target.value) }), _jsx("span", { className: "sm-settings-hint", children: txt('apiKeyHint') })] }), _jsxs("label", { className: "sm-settings-row", children: [_jsx("span", { className: "sm-settings-label", children: txt('serverPath') }), _jsx("input", { type: "text", value: serverPath, placeholder: "C:\\Users\\crack\\Supermemory\\supermemory-server-windows-x64.exe", spellCheck: false, onChange: (e) => setServerPath(e.target.value) }), _jsx("span", { className: "sm-settings-hint", children: txt('serverPathHint') })] }), _jsxs("label", { className: "sm-settings-row", children: [_jsx("span", { className: "sm-settings-label", children: txt('openaiApiKey') }), _jsx("input", { type: "password", value: openaiApiKey, spellCheck: false, autoComplete: "off", onChange: (e) => setOpenaiApiKey(e.target.value) })] }), _jsxs("label", { className: "sm-settings-row", children: [_jsx("span", { className: "sm-settings-label", children: txt('openaiBaseUrl') }), _jsx("input", { type: "text", value: openaiBaseUrl, placeholder: "https://token-plan-cn.xiaomimimo.com/v1", spellCheck: false, onChange: (e) => setOpenaiBaseUrl(e.target.value) })] }), _jsxs("label", { className: "sm-settings-row", children: [_jsx("span", { className: "sm-settings-label", children: txt('openaiModel') }), _jsx("input", { type: "text", value: openaiModel, placeholder: "mimo-v2.5", spellCheck: false, onChange: (e) => setOpenaiModel(e.target.value) })] }), _jsxs("label", { className: "sm-settings-row", children: [_jsx("span", { className: "sm-settings-label", children: txt('activeContainer') }), _jsxs("div", { className: "sm-settings-container-row", children: [_jsxs("select", { className: "sm-settings-select", value: creatingContainer ? '__new__' : activeContainer, onFocus: () => void loadContainers(), onClick: () => void loadContainers(), onChange: (e) => {
                                            const val = e.target.value;
                                            if (val === '__new__') {
                                                setCreatingContainer(true);
                                                setNewContainerName('');
                                            }
                                            else {
                                                setCreatingContainer(false);
                                                void saveContainer(val);
                                            }
                                        }, disabled: containersLoading && containers.length === 0, children: [containersLoading ? (_jsx("option", { value: "", children: txt('loadingContainers') })) : containers.length === 0 ? (_jsx("option", { value: "", children: txt('noContainers') })) : (containers.map((c) => (_jsxs("option", { value: c.tag, children: [c.tag, " \u2014 ", txt('containerStats').replace('{static}', String(c.staticCount)).replace('{dynamic}', String(c.dynamicCount))] }, c.tag)))), _jsx("option", { value: "__new__", children: txt('createNew') })] }), creatingContainer ? (_jsxs("div", { className: "sm-settings-container-new", children: [_jsx("input", { type: "text", className: "sm-settings-input-inline", value: newContainerName, placeholder: txt('createPlaceholder'), spellCheck: false, onKeyDown: (e) => {
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
                                                }, onChange: (e) => setNewContainerName(e.target.value), autoFocus: true }), _jsx("button", { type: "button", className: "sm-settings-test", disabled: !newContainerName.trim(), onClick: () => {
                                                    if (!newContainerName.trim())
                                                        return;
                                                    const tag = newContainerName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
                                                    void saveContainer(tag);
                                                    setCreatingContainer(false);
                                                    setNewContainerName('');
                                                    setTimeout(() => void loadContainers(true), 600);
                                                }, children: "\u2713" }), _jsx("button", { type: "button", className: "sm-settings-discard", onClick: () => { setCreatingContainer(false); setNewContainerName(''); }, children: "\u2715" })] })) : null] }), _jsx("span", { className: "sm-settings-hint", children: txt('activeContainerHint') })] }), _jsx("div", { className: "sm-settings-serverrow", children: _jsxs("span", { className: cn('sm-settings-status', managed?.state === 'running' && 'sm-settings-status-ok', (managed?.state === 'error' || managed?.state === 'missing-exe' || managed?.state === 'no-path') && 'sm-settings-status-err'), children: [txt('managedStatus'), ": ", mgtText(managed) ?? '—'] }) }), _jsxs("div", { className: "sm-settings-footer", children: [statusText ? (_jsx("span", { className: cn('sm-settings-status', status?.kind === 'ok' && 'sm-settings-status-ok', status?.kind === 'err' && 'sm-settings-status-err'), role: "status", children: statusText })) : saveFailed ? (_jsx("p", { className: "sm-settings-failed", role: "status", children: txt('saveFailed') })) : justSaved ? (_jsx("span", { className: "sm-settings-status sm-settings-status-ok", role: "status", children: txt('saved') })) : null, _jsx("button", { type: "button", className: "sm-settings-test", disabled: testing, onClick: () => void runTest(), children: testing ? txt('testing') : txt('test') }), _jsx("button", { type: "button", className: "sm-settings-discard", disabled: !dirty || saving, onClick: () => {
                                    setBaseUrl(server?.baseUrl ?? '');
                                    setApiKey(server?.apiKey ?? '');
                                    setServerPath(server?.serverPath ?? '');
                                    setOpenaiApiKey(server?.openaiApiKey ?? '');
                                    setOpenaiBaseUrl(server?.openaiBaseUrl ?? '');
                                    setOpenaiModel(server?.openaiModel ?? '');
                                    setActiveContainer(server?.activeContainer ?? '');
                                    setSaveFailed(false);
                                }, children: txt('discard') }), _jsx("button", { type: "button", className: "sm-settings-save", disabled: !dirty || saving, onClick: () => void commit(), children: saving ? txt('saving') : txt('save') })] })] })) : null] }));
}
