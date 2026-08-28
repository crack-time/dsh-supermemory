window.__ModuleLoader__.load({ id: "@crack/dsh-supermemory", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
let react_jsx_runtime = require("react/jsx-runtime");
let react = require("react");

//#region lib/client/card-locale.js
/**
* Locale dictionary for the Supermemory settings card.
*
* Split out of card.tsx so the UI component and the i18n data stay separate:
* a locale change never touches the component, and the dictionary can also be
* consumed by tests / other seats without pulling React in.
*/
/** Locale dictionary for the card. */
const CARD_LOCALE = {
	zh: {
		title: "Supermemory 代理",
		description: "本地记忆服务接入 dsh",
		baseUrl: "服务地址",
		baseUrlHint: "留空使用 http://localhost:6767",
		apiKey: "API Key",
		apiKeyHint: "在 localhost:6767 首页可查看",
		show: "显示",
		hide: "隐藏",
		save: "保存",
		saving: "保存中…",
		discard: "放弃修改",
		test: "测试连接",
		testing: "测试中…",
		unsaved: "未保存",
		saveFailed: "保存失败，请重试",
		saved: "已保存",
		expand: "展开",
		collapse: "折叠",
		checkFailed: "测试失败",
		ok: "可用",
		checking: "检查中…",
		loadFailed: "读取配置失败",
		emptyKey: "未配置 API Key",
		serverPath: "服务器可执行文件路径",
		serverPathHint: "例：C:UserscrackSupermemorysupermemory-server-windows-x64.exe",
		openaiApiKey: "OPENAI_API_KEY（记忆引擎模型密钥）",
		openaiBaseUrl: "OPENAI_BASE_URL",
		openaiModel: "OPENAI_MODEL",
		managedStatus: "托管状态",
		mgtNoPath: "请先填写服务器可执行文件路径并保存",
		mgtExternal: "已在运行（外部实例，未重复拉起）",
		mgtRunning: "托管运行中",
		mgtStarting: "启动中…",
		mgtStopped: "未启动",
		mgtMissingExe: "可执行文件缺失",
		mgtError: "启动失败",
		activeContainer: "当前记忆空间",
		activeContainerHint: "会话开始时自动注入的记忆上下文来源",
		loadingContainers: "加载中…",
		noContainers: "无可用记忆空间",
		createNew: "新建记忆空间…",
		containerStats: "{static} 长期 + {dynamic} 近期",
		createPlaceholder: "输入新空间名称（仅英文/数字/连字符）"
	},
	en: {
		title: "Supermemory proxy",
		description: "Local memory server access via dsh",
		baseUrl: "Base URL",
		baseUrlHint: "Leave empty for http://localhost:6767",
		apiKey: "API Key",
		apiKeyHint: "Shown on the localhost:6767 dashboard",
		show: "Show",
		hide: "Hide",
		save: "Save",
		saving: "Saving…",
		discard: "Discard",
		test: "Test",
		testing: "Testing…",
		unsaved: "Unsaved",
		saveFailed: "Save failed, retry",
		saved: "Saved",
		expand: "Expand",
		collapse: "Collapse",
		checkFailed: "Test failed",
		ok: "OK",
		checking: "Checking…",
		loadFailed: "Failed to read configuration",
		emptyKey: "API key not configured",
		serverPath: "Server executable path",
		serverPathHint: "e.g. C:UserscrackSupermemorysupermemory-server-windows-x64.exe",
		openaiApiKey: "OPENAI_API_KEY (memory-engine model key)",
		openaiBaseUrl: "OPENAI_BASE_URL",
		openaiModel: "OPENAI_MODEL",
		managedStatus: "Managed state",
		mgtNoPath: "Set the server executable path and save first",
		mgtExternal: "Already running (external instance, not re-launched)",
		mgtRunning: "Managed & running",
		mgtStarting: "Starting…",
		mgtStopped: "Not running",
		mgtMissingExe: "Executable missing",
		mgtError: "Failed to start",
		activeContainer: "Active memory space",
		activeContainerHint: "Memory context injected at session start",
		loadingContainers: "Loading…",
		noContainers: "No memory spaces",
		createNew: "Create new space…",
		containerStats: "{static} static + {dynamic} dynamic",
		createPlaceholder: "New space name (ascii only)"
	}
};

//#endregion
//#region lib/client/api.js
const API_URLS = {
	config: "/plugins/@crack/dsh-supermemory/api/config",
	health: "/plugins/@crack/dsh-supermemory/api/health",
	containers: "/plugins/@crack/dsh-supermemory/api/containers",
	activeContainer: "/plugins/@crack/dsh-supermemory/api/active-container",
	/** Per-session container: GET/PUT /api/session/:id/container */
	sessionContainer: (sessionId) => "/plugins/@crack/dsh-supermemory/api/session/" + encodeURIComponent(sessionId) + "/container"
};

//#endregion
//#region lib/client/card-state.js
/**
* Settings-card state + business logic, extracted from card.tsx so the
* component keeps only JSX and the hook stays testable on its own.
*
* The hook owns: config IO (load/save/commit), container discovery
* (cache-aware), connection test, and every piece of field state the card
* renders. It takes the translation function and the patch channel as
* dependencies (injected by the slot host), mirroring CardProps.
*/
const CONTAINER_TTL_MS = 6e4;
const DEFAULT_EMPTY = {
	baseUrl: "",
	apiKey: "",
	serverPath: "",
	openaiApiKey: "",
	openaiBaseUrl: "",
	openaiModel: "",
	activeContainer: ""
};
/** All state and actions behind the Supermemory settings card. */
function useSupermemoryCard(deps) {
	const { t, applyPatch } = deps;
	const [open, setOpen] = (0, react.useState)(false);
	const [loading, setLoading] = (0, react.useState)(false);
	const [baseUrl, setBaseUrl] = (0, react.useState)("");
	const [apiKey, setApiKey] = (0, react.useState)("");
	const [serverPath, setServerPath] = (0, react.useState)("");
	const [openaiApiKey, setOpenaiApiKey] = (0, react.useState)("");
	const [openaiBaseUrl, setOpenaiBaseUrl] = (0, react.useState)("");
	const [openaiModel, setOpenaiModel] = (0, react.useState)("");
	const [activeContainer, setActiveContainer] = (0, react.useState)("");
	const [containers, setContainers] = (0, react.useState)([]);
	const [containersLoading, setContainersLoading] = (0, react.useState)(false);
	const [creatingContainer, setCreatingContainer] = (0, react.useState)(false);
	const [newContainerName, setNewContainerName] = (0, react.useState)("");
	const [managed, setManaged] = (0, react.useState)(null);
	const [server, setServer] = (0, react.useState)(null);
	const [saving, setSaving] = (0, react.useState)(false);
	const [saveFailed, setSaveFailed] = (0, react.useState)(false);
	const [justSaved, setJustSaved] = (0, react.useState)(false);
	const [testing, setTesting] = (0, react.useState)(false);
	const [status, setStatus] = (0, react.useState)(null);
	const [loadErr, setLoadErr] = (0, react.useState)(false);
	const containersFetchedAtRef = (0, react.useRef)(0);
	const containersInFlightRef = (0, react.useRef)(false);
	const dirty = server !== null && (baseUrl.trim() !== server.baseUrl || apiKey.trim() !== server.apiKey || serverPath.trim() !== server.serverPath || openaiApiKey.trim() !== server.openaiApiKey || openaiBaseUrl.trim() !== server.openaiBaseUrl || openaiModel.trim() !== server.openaiModel || activeContainer.trim() !== (server.activeContainer ?? "").trim());
	async function load() {
		setLoadErr(false);
		setLoading(true);
		try {
			const res = await fetch(API_URLS.config, { cache: "no-store" });
			if (!res.ok) {
				setLoadErr(true);
				return;
			}
			const cfg = await res.json();
			setBaseUrl(cfg.baseUrl ?? "");
			setApiKey(cfg.apiKey ?? "");
			setServerPath(cfg.serverPath ?? "");
			setOpenaiApiKey(cfg.openaiApiKey ?? "");
			setOpenaiBaseUrl(cfg.openaiBaseUrl ?? "");
			setOpenaiModel(cfg.openaiModel ?? "");
			setActiveContainer(cfg.activeContainer ?? "");
			setServer({
				baseUrl: cfg.baseUrl ?? "",
				apiKey: cfg.apiKey ?? "",
				serverPath: cfg.serverPath ?? "",
				openaiApiKey: cfg.openaiApiKey ?? "",
				openaiBaseUrl: cfg.openaiBaseUrl ?? "",
				openaiModel: cfg.openaiModel ?? "",
				activeContainer: cfg.activeContainer ?? ""
			});
			setStatus(null);
			fetch(API_URLS.health, { cache: "no-store" }).then((r) => r.json().catch(() => ({}))).then((h) => h?.managed && setManaged(h.managed)).catch(() => {});
		} catch {
			setLoadErr(true);
		} finally {
			setLoading(false);
		}
	}
	(0, react.useEffect)(() => {
		if (!open) return;
		load();
	}, [open]);
	(0, react.useEffect)(() => {
		if (!open) return;
		if (!apiKey || !apiKey.trim()) return;
		loadContainers();
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
			const res = await fetch(API_URLS.containers, { cache: "no-store" });
			if (!res.ok) {
				setContainers([]);
				return;
			}
			const list = ((await res.json()).containers ?? []).map((c) => ({
				tag: c.tag,
				staticCount: c.staticCount ?? 0,
				dynamicCount: c.dynamicCount ?? 0
			}));
			setContainers(list);
			if (list.length > 0) containersFetchedAtRef.current = Date.now();
			if (!activeContainer.trim() && list.length > 0) {
				const first = list[0].tag;
				setActiveContainer(first);
				setServer((prev) => prev ? {
					...prev,
					activeContainer: first
				} : prev);
			}
		} catch {
			setContainers([]);
		} finally {
			containersInFlightRef.current = false;
			setContainersLoading(false);
		}
	}
	/** Save only the activeContainer field (dedicated switch endpoint). */
	async function saveContainer(tag) {
		setActiveContainer(tag);
		setServer((prev) => prev ? {
			...prev,
			activeContainer: tag
		} : prev);
		try {
			await fetch(API_URLS.activeContainer, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ containerTag: tag })
			});
		} catch {}
	}
	async function commit() {
		const patch = {};
		if (baseUrl.trim() !== (server?.baseUrl ?? "")) patch.baseUrl = baseUrl.trim();
		if (apiKey.trim() !== (server?.apiKey ?? "")) patch.apiKey = apiKey.trim();
		if (serverPath.trim() !== (server?.serverPath ?? "")) patch.serverPath = serverPath.trim();
		if (openaiApiKey.trim() !== (server?.openaiApiKey ?? "")) patch.openaiApiKey = openaiApiKey.trim();
		if (openaiBaseUrl.trim() !== (server?.openaiBaseUrl ?? "")) patch.openaiBaseUrl = openaiBaseUrl.trim();
		if (openaiModel.trim() !== (server?.openaiModel ?? "")) patch.openaiModel = openaiModel.trim();
		if (activeContainer.trim() !== (server?.activeContainer ?? "").trim()) patch.activeContainer = activeContainer.trim();
		if (Object.keys(patch).length === 0) return;
		setSaving(true);
		setSaveFailed(false);
		setJustSaved(false);
		try {
			if (!(await (applyPatch ?? (async (p) => {
				const res = await fetch(API_URLS.config, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ patch: p })
				});
				if (!res.ok) return {
					ok: false,
					error: (await res.text()).slice(0, 200)
				};
				return { ok: true };
			}))(patch)).ok) setSaveFailed(true);
			else {
				setServer((prev) => ({
					...prev ?? { ...DEFAULT_EMPTY },
					...patch
				}));
				setJustSaved(true);
				setStatus({
					kind: "ok",
					text: t("saved")
				});
				fetch(API_URLS.health, { cache: "no-store" }).then((r) => r.json().catch(() => ({}))).then((h) => h?.managed && setManaged(h.managed)).catch(() => {});
			}
		} catch {
			setSaveFailed(true);
		} finally {
			setSaving(false);
		}
	}
	async function runTest() {
		setTesting(true);
		setStatus({
			kind: "info",
			text: t("checking")
		});
		try {
			const res = await fetch(API_URLS.health, { cache: "no-store" });
			const data = await res.json().catch(() => ({}));
			if (data && data.managed) setManaged(data.managed);
			if (data && data.ok) setStatus({
				kind: "ok",
				text: t("ok") + " · " + (data.baseUrl ?? "")
			});
			else if (data && data.configured === false) setStatus({
				kind: "err",
				text: t("emptyKey")
			});
			else setStatus({
				kind: "err",
				text: t("checkFailed") + " · " + (data?.error ?? "HTTP " + String(res.status))
			});
		} catch {
			setStatus({
				kind: "err",
				text: t("checkFailed")
			});
		} finally {
			setTesting(false);
		}
	}
	const mgtText = (m) => {
		if (!m) return null;
		switch (m.state) {
			case "no-path": return t("mgtNoPath");
			case "external": return t("mgtExternal");
			case "running": return t("mgtRunning") + (m.pid ? " · PID " + m.pid : "");
			case "starting": return t("mgtStarting");
			case "stopped": return t("mgtStopped");
			case "missing-exe": return t("mgtMissingExe");
			case "error": return t("mgtError") + (m.error ? " · " + m.error : "");
			default: return m.state ?? "";
		}
	};
	return {
		open,
		loading,
		baseUrl,
		apiKey,
		serverPath,
		openaiApiKey,
		openaiBaseUrl,
		openaiModel,
		activeContainer,
		containers,
		containersLoading,
		creatingContainer,
		newContainerName,
		managed,
		server,
		saving,
		saveFailed,
		justSaved,
		testing,
		status,
		loadErr,
		dirty,
		mgtText,
		setOpen,
		setBaseUrl,
		setApiKey,
		setServerPath,
		setOpenaiApiKey,
		setOpenaiBaseUrl,
		setOpenaiModel,
		setActiveContainer,
		setContainers,
		setContainersLoading,
		setCreatingContainer,
		setNewContainerName,
		setManaged,
		setSaving,
		setSaveFailed,
		setJustSaved,
		setTesting,
		setStatus,
		setLoadErr,
		load,
		loadContainers,
		saveContainer,
		commit,
		runTest
	};
}

//#endregion
//#region lib/client/card.js
/**
* Settings-dialog card for the "supermemory" namespace — JSX only.
*
* Fields: base URL, API key, managed server + OpenAI settings and the active
* memory-space dropdown (create/switch). All state and IO live in the
* useSupermemoryCard hook (card-state.ts); locale in card-locale.ts; CSS in
* card-css.ts — the component stays focused on rendering.
*/
const DEFAULT_BASE_URL = "http://localhost:6767";
const cn = (...classes) => classes.filter(Boolean).join(" ");
function Chevron({ className }) {
	return (0, react_jsx_runtime.jsx)("svg", {
		width: 14,
		height: 14,
		viewBox: "0 0 12 12",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 1.5,
		strokeLinecap: "round",
		strokeLinejoin: "round",
		"aria-hidden": true,
		className,
		children: (0, react_jsx_runtime.jsx)("path", { d: "M6 10.75 L2.25 6.5 M6 10.75 L9.75 6.5" })
	});
}
function SupermemorySettingsCard(props) {
	const { t, applyPatch } = props;
	const lang = typeof navigator !== "undefined" && navigator.language && navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
	const txt = (key) => typeof t === "function" ? t(key) : CARD_LOCALE[lang][key] ?? key;
	const { open, baseUrl, apiKey, serverPath, openaiApiKey, openaiBaseUrl, openaiModel, managed, server, saving, saveFailed, justSaved, testing, status, loadErr, dirty, mgtText, setOpen, setBaseUrl, setApiKey, setServerPath, setOpenaiApiKey, setOpenaiBaseUrl, setOpenaiModel, setSaveFailed, commit, runTest } = useSupermemoryCard({
		t: txt,
		applyPatch
	});
	const title = txt("title");
	const statusText = status ? status.text : loadErr ? txt("loadFailed") : null;
	return (0, react_jsx_runtime.jsxs)("li", {
		"data-supermemory-settings": true,
		className: cn("sm-settings-card", open && "sm-settings-card-open"),
		children: [(0, react_jsx_runtime.jsxs)("button", {
			type: "button",
			className: "sm-settings-header",
			"aria-expanded": open,
			"aria-label": `${txt(open ? "collapse" : "expand")}: ${title}`,
			onClick: () => setOpen((v) => !v),
			children: [
				(0, react_jsx_runtime.jsxs)("span", {
					className: "sm-settings-headText",
					children: [(0, react_jsx_runtime.jsx)("span", {
						className: "sm-settings-name",
						children: title
					}), (0, react_jsx_runtime.jsx)("span", {
						className: "sm-settings-description",
						children: txt("description")
					})]
				}),
				dirty ? (0, react_jsx_runtime.jsx)("span", {
					className: "sm-settings-pending",
					children: txt("unsaved")
				}) : null,
				(0, react_jsx_runtime.jsx)(Chevron, { className: cn("sm-settings-chevron", open && "sm-settings-chevron-open") })
			]
		}), open ? (0, react_jsx_runtime.jsxs)("div", {
			className: "sm-settings-body",
			children: [
				(0, react_jsx_runtime.jsxs)("label", {
					className: "sm-settings-row",
					children: [
						(0, react_jsx_runtime.jsx)("span", {
							className: "sm-settings-label",
							children: txt("baseUrl")
						}),
						(0, react_jsx_runtime.jsx)("input", {
							type: "text",
							value: baseUrl,
							placeholder: DEFAULT_BASE_URL,
							spellCheck: false,
							onChange: (e) => setBaseUrl(e.target.value)
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: "sm-settings-hint",
							children: txt("baseUrlHint")
						})
					]
				}),
				(0, react_jsx_runtime.jsxs)("label", {
					className: "sm-settings-row",
					children: [
						(0, react_jsx_runtime.jsx)("span", {
							className: "sm-settings-label",
							children: txt("apiKey")
						}),
						(0, react_jsx_runtime.jsx)("input", {
							type: "password",
							value: apiKey,
							placeholder: "sm_...",
							spellCheck: false,
							autoComplete: "off",
							onChange: (e) => setApiKey(e.target.value)
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: "sm-settings-hint",
							children: txt("apiKeyHint")
						})
					]
				}),
				(0, react_jsx_runtime.jsxs)("label", {
					className: "sm-settings-row",
					children: [
						(0, react_jsx_runtime.jsx)("span", {
							className: "sm-settings-label",
							children: txt("serverPath")
						}),
						(0, react_jsx_runtime.jsx)("input", {
							type: "text",
							value: serverPath,
							placeholder: "C:\\Users\\crack\\Supermemory\\supermemory-server-windows-x64.exe",
							spellCheck: false,
							onChange: (e) => setServerPath(e.target.value)
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: "sm-settings-hint",
							children: txt("serverPathHint")
						})
					]
				}),
				(0, react_jsx_runtime.jsxs)("label", {
					className: "sm-settings-row",
					children: [(0, react_jsx_runtime.jsx)("span", {
						className: "sm-settings-label",
						children: txt("openaiApiKey")
					}), (0, react_jsx_runtime.jsx)("input", {
						type: "password",
						value: openaiApiKey,
						spellCheck: false,
						autoComplete: "off",
						onChange: (e) => setOpenaiApiKey(e.target.value)
					})]
				}),
				(0, react_jsx_runtime.jsxs)("label", {
					className: "sm-settings-row",
					children: [(0, react_jsx_runtime.jsx)("span", {
						className: "sm-settings-label",
						children: txt("openaiBaseUrl")
					}), (0, react_jsx_runtime.jsx)("input", {
						type: "text",
						value: openaiBaseUrl,
						placeholder: "https://token-plan-cn.xiaomimimo.com/v1",
						spellCheck: false,
						onChange: (e) => setOpenaiBaseUrl(e.target.value)
					})]
				}),
				(0, react_jsx_runtime.jsxs)("label", {
					className: "sm-settings-row",
					children: [(0, react_jsx_runtime.jsx)("span", {
						className: "sm-settings-label",
						children: txt("openaiModel")
					}), (0, react_jsx_runtime.jsx)("input", {
						type: "text",
						value: openaiModel,
						placeholder: "mimo-v2.5",
						spellCheck: false,
						onChange: (e) => setOpenaiModel(e.target.value)
					})]
				}),
				(0, react_jsx_runtime.jsx)("div", {
					className: "sm-settings-serverrow",
					children: (0, react_jsx_runtime.jsxs)("span", {
						className: cn("sm-settings-status", managed?.state === "running" && "sm-settings-status-ok", (managed?.state === "error" || managed?.state === "missing-exe" || managed?.state === "no-path") && "sm-settings-status-err"),
						children: [
							txt("managedStatus"),
							": ",
							mgtText(managed) ?? "—"
						]
					})
				}),
				(0, react_jsx_runtime.jsxs)("div", {
					className: "sm-settings-footer",
					children: [
						statusText ? (0, react_jsx_runtime.jsx)("span", {
							className: cn("sm-settings-status", status?.kind === "ok" && "sm-settings-status-ok", status?.kind === "err" && "sm-settings-status-err"),
							role: "status",
							children: statusText
						}) : saveFailed ? (0, react_jsx_runtime.jsx)("p", {
							className: "sm-settings-failed",
							role: "status",
							children: txt("saveFailed")
						}) : justSaved ? (0, react_jsx_runtime.jsx)("span", {
							className: "sm-settings-status sm-settings-status-ok",
							role: "status",
							children: txt("saved")
						}) : null,
						(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "sm-settings-test",
							disabled: testing,
							onClick: () => void runTest(),
							children: testing ? txt("testing") : txt("test")
						}),
						(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "sm-settings-discard",
							disabled: !dirty || saving,
							onClick: () => {
								setBaseUrl(server?.baseUrl ?? "");
								setApiKey(server?.apiKey ?? "");
								setServerPath(server?.serverPath ?? "");
								setOpenaiApiKey(server?.openaiApiKey ?? "");
								setOpenaiBaseUrl(server?.openaiBaseUrl ?? "");
								setOpenaiModel(server?.openaiModel ?? "");
								setSaveFailed(false);
							},
							children: txt("discard")
						}),
						(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "sm-settings-save",
							disabled: !dirty || saving,
							onClick: () => void commit(),
							children: saving ? txt("saving") : txt("save")
						})
					]
				})
			]
		}) : null]
	});
}

//#endregion
//#region lib/client/header-badge.js
/**
* Header badge showing the active memory container name.
*
* Registers into the `conversation.session.header.actions` list slot
* so it appears as a chip/badge next to the agent-preset label in the
* session header area.
*/
/** Inline styles matching the DSH badge aesthetic. */
const STYLES = {
	badge: {
		display: "inline-flex",
		alignItems: "center",
		gap: "4px",
		padding: "2px 8px",
		borderRadius: "999px",
		border: "none",
		fontSize: "12px",
		fontWeight: 500,
		lineHeight: "17px",
		color: "var(--dsw-alias-text-2, rgba(0,0,0,0.6))",
		background: "transparent",
		whiteSpace: "nowrap",
		cursor: "default",
		userSelect: "none"
	},
	icon: {
		width: "14px",
		height: "14px",
		opacity: .6
	}
};
/** SVG memory icon (simplified database/cylinder). */
function MemoryIcon$1() {
	return (0, react_jsx_runtime.jsxs)("svg", {
		style: STYLES.icon,
		viewBox: "0 0 16 16",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "1.5",
		strokeLinecap: "round",
		children: [
			(0, react_jsx_runtime.jsx)("ellipse", {
				cx: "8",
				cy: "4",
				rx: "5",
				ry: "2"
			}),
			(0, react_jsx_runtime.jsx)("path", { d: "M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" }),
			(0, react_jsx_runtime.jsx)("path", { d: "M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" })
		]
	});
}
/**
* Memory space badge — rendered inside the session header actions list.
* Props come from the DSH slot framework.
*/
function MemorySpaceBadge(props) {
	const t = props.t;
	const [container, setContainer] = (0, react.useState)(null);
	const sessionId = props.sessionId;
	(0, react.useEffect)(() => {
		let alive = true;
		async function load() {
			try {
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
				const res = await fetch(API_URLS.config);
				if (!res.ok) return;
				const data = await res.json();
				if (alive && data?.activeContainer) setContainer(data.activeContainer);
			} catch {}
		}
		load();
		const timer = setInterval(load, 3e4);
		return () => {
			alive = false;
			clearInterval(timer);
		};
	}, [sessionId]);
	if (!container) return null;
	const label = t?.("activeContainer") ?? "Space";
	return (0, react_jsx_runtime.jsxs)("span", {
		style: STYLES.badge,
		title: `${label}: ${container}`,
		children: [(0, react_jsx_runtime.jsx)(MemoryIcon$1, {}), container]
	});
}

//#endregion
//#region lib/client/memory-selector.js
/**
* Compact memory-space selector for the input bar (conversation.input.right).
*
* Mirrors the ModelSelect trigger/menu aesthetic from
* @deepseek-ai/dsh-client-ui-model-selection so the two selectors look like
* siblings in the composer trailing area.
*/
const T = {
	trigger: {
		minWidth: 0,
		maxWidth: "min(360px, 45cqw)",
		height: "28px",
		color: "var(--dsw-alias-label-secondary)",
		cursor: "pointer",
		background: "transparent",
		border: "none",
		borderRadius: "24px",
		outline: "none",
		alignItems: "center",
		gap: "4px",
		padding: "0 8px",
		fontSize: "13px",
		fontWeight: 500,
		lineHeight: "20px",
		display: "inline-flex",
		whiteSpace: "nowrap",
		userSelect: "none"
	},
	triggerHover: { background: "var(--dsw-alias-interactive-bg-hover)" },
	icon: {
		width: "14px",
		height: "14px",
		flex: "none",
		opacity: .7
	},
	chevron: {
		color: "var(--dsw-alias-label-caption)",
		flex: "none",
		transition: "transform .12s",
		width: "12px",
		height: "12px"
	},
	chevronOpen: { transform: "rotate(180deg)" },
	menu: {
		zIndex: 20,
		border: "1px solid var(--dsw-alias-border-inverted)",
		background: "var(--dsw-specific-menu)",
		width: "max-content",
		minWidth: "min(200px, 100vw - 32px)",
		maxWidth: "min(320px, 100vw - 32px)",
		maxHeight: "min(360px, 100vh - 96px)",
		boxShadow: "var(--dsw-shadow-lv3)",
		color: "var(--dsw-alias-label-primary)",
		borderRadius: "12px",
		flexDirection: "column",
		padding: "4px",
		display: "flex",
		position: "absolute",
		bottom: "calc(100% + 8px)",
		right: 0,
		overflowY: "auto"
	},
	option: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		padding: "6px 8px",
		fontSize: "13px",
		lineHeight: "20px",
		cursor: "pointer",
		borderRadius: "8px",
		color: "var(--dsw-alias-label-primary)"
	},
	optionSelected: {
		background: "var(--dsw-alias-interactive-bg-hover)",
		fontWeight: 600
	},
	optionHover: { background: "var(--dsw-alias-interactive-bg-hover)" },
	count: {
		fontSize: "12px",
		lineHeight: "18px",
		color: "var(--dsw-alias-label-caption)",
		marginLeft: "8px",
		flex: "none"
	}
};
function MemoryIcon() {
	return (0, react_jsx_runtime.jsxs)("svg", {
		style: T.icon,
		viewBox: "0 0 16 16",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "1.5",
		strokeLinecap: "round",
		children: [
			(0, react_jsx_runtime.jsx)("ellipse", {
				cx: "8",
				cy: "4",
				rx: "5",
				ry: "2"
			}),
			(0, react_jsx_runtime.jsx)("path", { d: "M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" }),
			(0, react_jsx_runtime.jsx)("path", { d: "M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" })
		]
	});
}
function ChevronDown({ open }) {
	return (0, react_jsx_runtime.jsx)("svg", {
		style: {
			...T.chevron,
			...open ? T.chevronOpen : {}
		},
		viewBox: "0 0 12 12",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "1.5",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		children: (0, react_jsx_runtime.jsx)("path", { d: "M3 4.5L6 7.5L9 4.5" })
	});
}
function MemorySelector(props) {
	const sessionId = props.sessionId;
	const [containers, setContainers] = (0, react.useState)([]);
	const [active, setActive] = (0, react.useState)("");
	const [open, setOpen] = (0, react.useState)(false);
	const [hovered, setHovered] = (0, react.useState)(null);
	const [triggerHover, setTriggerHover] = (0, react.useState)(false);
	const wrapperRef = (0, react.useRef)(null);
	(0, react.useEffect)(() => {
		let alive = true;
		async function load() {
			try {
				const fetches = [fetch(API_URLS.containers)];
				if (sessionId) fetches.push(fetch(API_URLS.sessionContainer(sessionId)));
				const results = await Promise.all(fetches);
				if (!alive) return;
				const listRes = results[0];
				const sessionRes = sessionId ? results[1] : void 0;
				const list = listRes.ok ? await listRes.json() : {};
				const session = sessionRes?.ok ? await sessionRes.json() : {};
				setActive(session.containerTag ?? "");
				setContainers((list.containers ?? []).map((c) => ({
					tag: c.tag,
					staticCount: c.staticCount ?? 0,
					dynamicCount: c.dynamicCount ?? 0
				})));
			} catch {}
		}
		load();
		return () => {
			alive = false;
		};
	}, [sessionId]);
	(0, react.useEffect)(() => {
		if (!open) return;
		const handler = (e) => {
			if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);
	async function select(tag) {
		if (tag === active) {
			setOpen(false);
			return;
		}
		try {
			const url = sessionId ? API_URLS.sessionContainer(sessionId) : API_URLS.activeContainer;
			if ((await fetch(url, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ containerTag: tag })
			})).ok) setActive(tag);
		} catch {}
		setOpen(false);
	}
	if (containers.length === 0) return null;
	return (0, react_jsx_runtime.jsxs)("div", {
		ref: wrapperRef,
		style: {
			position: "relative",
			display: "inline-flex",
			alignItems: "center"
		},
		children: [(0, react_jsx_runtime.jsxs)("button", {
			type: "button",
			style: {
				...T.trigger,
				...triggerHover ? T.triggerHover : {}
			},
			onClick: () => setOpen(!open),
			onMouseEnter: () => setTriggerHover(true),
			onMouseLeave: () => setTriggerHover(false),
			title: "Switch memory space",
			children: [
				(0, react_jsx_runtime.jsx)(MemoryIcon, {}),
				(0, react_jsx_runtime.jsx)("span", {
					style: {
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						minWidth: 0,
						overflow: "hidden"
					},
					children: active || "—"
				}),
				(0, react_jsx_runtime.jsx)(ChevronDown, { open })
			]
		}), open && (0, react_jsx_runtime.jsx)("div", {
			style: T.menu,
			children: containers.map((c) => (0, react_jsx_runtime.jsxs)("div", {
				style: {
					...T.option,
					...c.tag === active ? T.optionSelected : {},
					...hovered === c.tag && c.tag !== active ? T.optionHover : {}
				},
				onMouseEnter: () => setHovered(c.tag),
				onMouseLeave: () => setHovered(null),
				onClick: () => select(c.tag),
				children: [(0, react_jsx_runtime.jsx)("span", { children: c.tag }), (0, react_jsx_runtime.jsx)("span", {
					style: T.count,
					children: c.staticCount + c.dynamicCount
				})]
			}, c.tag))
		})]
	});
}

//#endregion
//#region lib/client/card-css.js
/**
* Card styles for the Supermemory settings card — same values as the built-in
* PluginCard (via the skin card's recreation of PluginCard.module.css), keyed
* off [data-supermemory-settings] so they never leak outside this card.
*
* Split out of card.tsx: CSS is a build artifact injected once at plugin
* apply time, not component logic. Kept as an inline string (tsc strips CSS
* imports; no build-pipeline changes needed).
*/
const CARD_CSS = `
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
[data-supermemory-settings] .sm-settings-container-row {
  flex-direction: column;
  gap: 6px;
  display: flex;
}
[data-supermemory-settings] .sm-settings-select {
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
  cursor: pointer;
}
[data-supermemory-settings] .sm-settings-select:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -1px;
}
[data-supermemory-settings] .sm-settings-container-new {
  flex-direction: row;
  gap: 6px;
  display: flex;
  align-items: center;
}
[data-supermemory-settings] .sm-settings-input-inline {
  flex: 1;
  box-sizing: border-box;
  height: 30px;
  padding: 4px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
}
[data-supermemory-settings] .sm-settings-input-inline:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -1px;
}
`;
let cssInjected = false;
/** Inject the card styles once (idempotent; safe to call from apply()). */
function injectCardCss() {
	if (cssInjected || typeof document === "undefined") return;
	cssInjected = true;
	try {
		const style = document.createElement("style");
		style.dataset.plugin = "dsh-supermemory";
		style.textContent = CARD_CSS;
		document.head.appendChild(style);
	} catch {}
}

//#endregion
//#region lib/client/index.js
/** Client-side service dependencies (runtime inject declaration; mirrors the
* package.json dsh.client.inject metadata). */
const inject = ["locale", "slots"];
const DICT = "dsh-supermemory";
function apply(ctx) {
	injectCardCss();
	ctx.locale?.register?.(DICT, CARD_LOCALE);
	const slots = ctx.slots;
	slots?.inject?.("conversation.session.header.actions", function* () {
		yield slots.register({
			name: "conversation.session.header.actions",
			id: "supermemory-space",
			order: -5,
			locale: DICT,
			inject: (sessionId) => ({
				hooks: {},
				sessionId
			})
		}, MemorySpaceBadge);
	});
	slots?.inject?.("conversation.input.right", function* () {
		yield slots.register({
			name: "conversation.input.right",
			id: "supermemory-selector",
			order: 50,
			locale: DICT,
			inject: (sessionId) => ({
				hooks: {},
				sessionId
			})
		}, MemorySelector);
	});
	slots?.inject?.("settings.plugin.item", function* () {
		yield slots.register({
			name: "settings.plugin.item",
			key: "supermemory",
			locale: DICT,
			inject: () => ({
				hooks: {},
				applyPatch: async (patch) => {
					try {
						const res = await fetch(API_URLS.config, {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ patch })
						});
						if (!res.ok) return {
							ok: false,
							error: (await res.text()).slice(0, 200)
						};
						return { ok: true };
					} catch {
						return {
							ok: false,
							error: "network"
						};
					}
				}
			})
		}, SupermemorySettingsCard);
	});
}

//#endregion
exports.apply = apply;
exports.inject = inject;
return module.exports; } });
//# sourceMappingURL=client.js.map