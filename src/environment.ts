/**
 * Dynamic environment context block — rendered at the top of the runtime
 * context so the model immediately knows the host environment.
 *
 * Information sources:
 *   cwd   → session.header.cwd
 *   git   → existsSync(cwd + '/.git')
 *   shell → ctx.shell executor constructor name (PwshLocalExecutor → pwsh),
 *           or the WSL shell when the workspace lives inside a WSL distro
 *   OS    → process.platform + os.release() (or the WSL distro for WSL workspaces)
 *   uv    → probed in well-known locations; for WSL workspaces it is resolved
 *           from the WSL side (fs share + wsl.exe), cached + persisted
 *
 * WSL workspaces are registered by dsh-wsl under a UNC share:
 *   \\wsl.localhost\<distro>\<linux-path>   (legacy: \\wsl$\<distro>\<linux-path>)
 * When the session cwd matches that shape the whole environment block is
 * rendered from the *linux* environment (bash, distro uv/python, Linux kernel)
 * instead of the Windows host values — because from the host's point of view
 * `ctx.shell` is still the pwsh executor, which would be wrong to report.
 *
 * WSL probe architecture (kept deliberately small — one manager, one resolve):
 *   • probeWslFs — synchronous read of the \\wsl.localhost filesystem share
 *     (os-release + uv/python candidate paths). Runs on every render: cheap,
 *     immediate, and gives real data without wsl.exe.
 *   • WslProbeManager — orchestrates the layers. Warm it at session creation
 *     (`ensure`) and pre-warm at plugin activation (`prewarm`); the render
 *     path only ever reads (`resolve`), it never blocks.
 *     Layer precedence in resolve(): fs < persisted < live settled.
 *     The one blocking action — `probeWslSync` (a synchronous wsl.exe call) —
 *     runs at most once per distro per process, and its result is also written
 *     to a persistent cache (~/.dsh/supermemory/wsl-env.json) so later host
 *     starts render from disk on the very first step without re-probing.
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { release as osRelease, homedir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// WSL workspace detection
// ---------------------------------------------------------------------------

/** Match \\wsl.localhost\<distro>\... or the legacy \\wsl$\<distro>\... */
const WSL_ROOT_RE = /^\\\\wsl(?:\.localhost)?\$?\\/i;
/** Capture the distro name from a WSL UNC path. */
const WSL_DISTRO_RE = /^\\\\wsl(?:\.localhost)?\$?\\([^\\]+)/i;
/** Capture the \\wsl(<.localhost>)<\distro> prefix for building child paths. */
const WSL_PREFIX_RE = /^(\\\\wsl(?:\.localhost)?\$?\\[^\\]+)/i;
/** Capture …\home\<user> inside a WSL UNC path. */
const WSL_HOME_RE = /^(\\\\wsl(?:\.localhost)?\$?\\[^\\]+\\home\\[^\\]+)/i;

/** True when a (Windows-host) cwd points inside a WSL distro share. */
export function isWslWorkspace(cwd: string): boolean {
    return WSL_ROOT_RE.test(cwd);
}

/** Extract the distro name from a WSL UNC cwd ('' when not a WSL path). */
export function distroOf(cwd: string): string {
    return cwd.match(WSL_DISTRO_RE)?.[1] ?? '';
}

/** Convert a WSL UNC file path to its plain Linux form: \\wsl.localhost\Ubuntu\home\a\b → /home/a/b. */
function uncToLinux(p: string): string {
    const m = p.match(/^\\\\wsl(?:\.localhost)?\$?\\[^\\]+\\?(.*)$/i);
    if (!m) return p;
    return '/' + (m[1] ?? '').split('\\').filter(Boolean).join('/');
}

// ---------------------------------------------------------------------------
// Sync, non-blocking fs layer — read the WSL filesystem share directly
// ---------------------------------------------------------------------------

/** like existsSync but never throws (denied / unreachable / bad path). */
function anyDir(p: string): boolean {
    try { return existsSync(p); } catch { return false; }
}

/** like readFileSync but never throws. */
function readMaybe(p: string): string | undefined {
    try { return readFileSync(p, 'utf8'); } catch { return undefined; }
}

/** Derive plausible user home UNC directories for a WSL cwd. */
function wslHomeCandidates(cwd: string): string[] {
    const homes = new Set<string>();
    const prefix = cwd.match(WSL_PREFIX_RE)?.[1];
    if (!prefix) return [];
    const direct = cwd.match(WSL_HOME_RE)?.[1];
    if (direct) homes.add(direct);
    const user = cwd.match(/\\home\\([^\\]+)/)?.[1];
    if (user) homes.add(`${prefix}\\home\\${user}`);
    if (homes.size === 0) homes.add(`${prefix}\\home\\crack`);
    homes.add(`${prefix}\\home\\linuxbrew`); // known linuxbrew prefix
    return [...homes];
}

/** Synchronous best-effort probe read straight off the WSL filesystem share. */
function probeWslFs(cwd: string): WslProbe {
    const probe: WslProbe = { distro: distroOf(cwd), shell: 'bash' };
    const prefix = cwd.match(WSL_PREFIX_RE)?.[1];
    if (!prefix) return probe;

    const osText = readMaybe(`${prefix}\\etc\\os-release`);
    const m = osText?.match(/^PRETTY_NAME\s*=\s*"?([^"\n]+)"?/m);
    if (m?.[1]) probe.osName = m[1];

    for (const home of wslHomeCandidates(cwd)) {
        // uv: ~/.local, ~/.cargo, ~/.uv, and the linuxbrew home's .linuxbrew tree
        // (brew installs land under /home/linuxbrew/.linuxbrew/bin).
        for (const rel of ['.local\\bin\\uv', '.cargo\\bin\\uv', '.uv\\bin\\uv', '.linuxbrew\\bin\\uv']) {
            if (anyDir(`${home}\\${rel}`)) { probe.uv = uncToLinux(`${home}\\${rel}`); break; }
        }
        if (probe.uv) break;
        for (const rel of ['.local\\bin\\uvx', '.linuxbrew\\bin\\uvx']) {
            if (anyDir(`${home}\\${rel}`)) { probe.uvx = uncToLinux(`${home}\\${rel}`); break; }
        }
    }
    if (!probe.python && anyDir(`${prefix}\\usr\\bin\\python3`)) probe.python = '/usr/bin/python3';
    return probe;
}

// ---------------------------------------------------------------------------
// WSL wsl.exe probe (marker-line format — survives the Windows→WSL argv edge)
// ---------------------------------------------------------------------------

/** What we know about a WSL distro's toolchain. */
export interface WslProbe {
    distro: string;
    /** Linux username (uid 0-owner). */
    user?: string;
    /** Linux home directory, e.g. /home/crack. */
    home?: string;
    /** $SHELL basename inside the distro, e.g. bash. */
    shell: string;
    /** `command -v uv` result (or a well-known fallback), e.g. /home/linuxbrew/.linuxbrew/bin/uv. */
    uv?: string;
    /** `command -v uvx` result. */
    uvx?: string;
    /** `command -v python3` result. */
    python?: string;
    /** distro pretty name, e.g. "Ubuntu 22.04.5 LTS". */
    osName?: string;
    /** Linux kernel release, e.g. 5.15.153.1-microsoft-standard-WSL2. */
    kernel?: string;
}

/** A probe "carries signal" once it has any real toolchain/distro data. */
function isHealthy(p?: WslProbe): boolean {
    return Boolean(p && (p.osName || p.uv || p.uvx || p.python || p.kernel));
}

/** The bash one-liner used to probe a distro.
 *
 * IMPORTANT: this runs via `wsl.exe -- bash -c '<cmd>'`, which is fiddly across
 * the Windows→WSL argv boundary — do NOT source dotfiles, reference a variable
 * whose value contains spaces (e.g. $PRETTY_NAME), or build multi-token values
 * with `command -v`/PATH. Instead use the marker-line format: each `echo
 * __KEY__` is followed by a plain value line (produced by `test -x … && echo
 * …` / `command -v` / `grep` / `uname`), or an empty line. This survives intact.
 */
function probeScript(): string {
    return [
        'echo __UVX__', 'test -x /home/linuxbrew/.linuxbrew/bin/uvx && echo /home/linuxbrew/.linuxbrew/bin/uvx',
        'echo __UV__', 'test -x /home/linuxbrew/.linuxbrew/bin/uv && echo /home/linuxbrew/.linuxbrew/bin/uv',
        'echo __UVL__', 'test -x ${HOME}/.local/bin/uv && echo ${HOME}/.local/bin/uv',
        'echo __UVC__', 'test -x /home/crack/.cargo/bin/uv && echo /home/crack/.cargo/bin/uv',
        'echo __PY__', 'command -v python3',
        'echo __SH__', 'echo ${SHELL}',
        'echo __OS__', 'grep -m1 PRETTY_NAME /etc/os-release',
        'echo __KERNEL__', 'uname -r',
    ].join(';');
}

/** Parse the marker-line probe output (each __KEY__ line is followed by a value line). */
function parseProbe(distro: string, out: string): WslProbe {
    const probe: WslProbe = { distro, shell: 'bash' };
    const lines = out.split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
        const m = lines[i]!.match(/^__([A-Z0-9_]+)__$/);
        if (!m) { i += 1; continue; }
        const key = m[1]!.toLowerCase();
        i += 1;
        const value = (i < lines.length ? lines[i]!.trim() : '');
        i += 1;
        if (!value) continue;
        switch (key) {
            case 'uvx': if (!probe.uv && !probe.uvx) probe.uvx = value; break;
            case 'uv':
            case 'uvl':
            case 'uvc': if (!probe.uv) probe.uv = value; break;
            case 'py': if (!probe.python) probe.python = value; break;
            case 'sh': probe.shell = value; break;
            case 'os': probe.osName = cleanOsName(value) || probe.osName; break;
            case 'kernel': probe.kernel = value; break;
            default: break;
        }
    }
    if (probe.shell.includes('/')) probe.shell = probe.shell.split('/').pop() ?? probe.shell;
    return probe;
}

/** Normalize a `PRETTY_NAME="..."` line to (value after first `=`), quotes stripped. */
function cleanOsName(line: string): string | undefined {
    const eq = line.indexOf('=');
    const raw = eq >= 0 ? line.slice(eq + 1).trim() : line.trim();
    const stripped = raw.replace(/^["']/, '').replace(/["']$/, '');
    return stripped || undefined;
}

/** Run one non-interactive bash command inside a distro; resolve with stdout. */
async function wslBash(distro: string, script: string): Promise<string> {
    const { stdout } = await execFile(
        'wsl.exe',
        ['-d', distro, '--', 'bash', '-lc', script],
        { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 30_000 },
    );
    return stdout;
}

/** Asynchronous probe (used for non-blocking refresh / pre-warm). */
async function probeWsl(distro: string): Promise<WslProbe | undefined> {
    try {
        return parseProbe(distro, await wslBash(distro, probeScript()));
    } catch { return undefined; }
}

/** Synchronous probe — blocks the current task up to a few seconds. Caches +
 *  persists on success. Returns the probe or undefined when it fails. */
function probeWslSync(distro: string): WslProbe | undefined {
    try {
        const out = execFileSync(
            'wsl.exe',
            ['-d', distro, '--', 'bash', '-lc', probeScript()],
            { encoding: 'utf8', windowsHide: true, timeout: 20_000, maxBuffer: 4 * 1024 * 1024 },
        );
        const probe = parseProbe(distro, String(out));
        return isHealthy(probe) ? probe : undefined;
    } catch (err: unknown) {
        log?.(`[supermemory:wsl-env] ${distro}: sync probe failed (${err instanceof Error ? err.message : err})`);
        return undefined;
    }
}

/** Enumerate installed WSL distros (order preserved; defaults first).
 *  wsl.exe writes the listing as UTF-16LE, so sniff the encoding. */
async function listDistros(): Promise<string[]> {
    const { stdout } = await execFile('wsl.exe', ['-l', '-q'], {
        encoding: 'buffer',
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        timeout: 20_000,
    });
    const buf = stdout as Buffer;
    let text: string;
    if (buf.length >= 2 && (buf.readUInt16LE(0) === 0xfeff || buf.indexOf(0) !== -1)) {
        text = buf.toString('utf16le').replace(/^\uFEFF/, '');
    } else {
        text = buf.toString('utf8');
    }
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && line !== '*');
}

// ---------------------------------------------------------------------------
// WslProbeManager — orchestration (single place that owns probe state)
// ---------------------------------------------------------------------------

/** Persistent cache location (also serves as a diagnostics surface). */
const CACHE_DIR = join(homedir(), '.dsh', 'supermemory');
const CACHE_FILE = join(CACHE_DIR, 'wsl-env.json');

/** Optional diagnostics hook (wired from the host apply()). */
let log: ((m: string) => void) | undefined;
export function setProbeLog(fn?: (m: string) => void): void {
    log = fn;
}

class WslProbeManager {
    /** Live healthy probes for this process (by distro). */
    private readonly settled = new Map<string, WslProbe>();
    /** Last known-good probes loaded from disk (by distro). */
    private readonly persisted = new Map<string, WslProbe>();
    /** Async refreshes in flight (by distro). */
    private readonly inflight = new Map<string, Promise<void>>();
    /** Distros already given the blocking sync probe this process. */
    private readonly syncDone = new Set<string>();

    constructor() {
        try {
            const data = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as
                | { distros?: Record<string, WslProbe> }
                | undefined;
            for (const [distro, probe] of Object.entries(data?.distros ?? {})) {
                if (isHealthy(probe)) this.persisted.set(distro, probe);
            }
        } catch { /* no cache yet / unreadable */ }
    }

    /** True while an async refresh is running and there is no live data yet. */
    isProbing(distro: string): boolean {
        return this.inflight.has(distro) && !isHealthy(this.settled.get(distro));
    }

    /**
     * Resolve the best-known probe for a distro. PURE READ — never blocks,
     * never triggers I/O beyond the cheap fs layer. Layer precedence:
     *   fs (synchronous share read) < persisted (disk) < settled (live).
     * Only healthy layers contribute, so a partial probe still improves output.
     */
    resolve(distro: string, cwd: string): WslProbe {
        const layers = [probeWslFs(cwd), this.persisted.get(distro), this.settled.get(distro)]
            .filter((p): p is WslProbe => isHealthy(p));
        return Object.assign({}, ...layers);
    }

    /** Write the settled + persisted view to disk (best effort). */
    private persist(): void {
        try {
            mkdirSync(CACHE_DIR, { recursive: true });
            const now = new Date().toISOString();
            const distros: Record<string, WslProbe & { updatedAt: string }> = {};
            for (const [distro, probe] of this.settled) {
                if (isHealthy(probe)) distros[distro] = { ...probe, updatedAt: now };
            }
            writeFileSync(CACHE_FILE, JSON.stringify({ updatedAt: now, distros }, null, 2), 'utf8');
        } catch { /* not writable — cache is best-effort only */ }
    }

    /** Non-blocking async refresh: probe in the background, cache on success. */
    private refreshAsync(distro: string): void {
        if (this.inflight.has(distro)) return;
        const job = probeWsl(distro)
            .then((probe) => {
                if (probe && isHealthy(probe)) {
                    this.settled.set(distro, probe);
                    this.persisted.set(distro, probe);
                    this.persist();
                    log?.(`[supermemory:wsl-env] ${distro}: ${JSON.stringify({ osName: probe.osName, uv: probe.uv, shell: probe.shell })}`);
                }
            })
            .catch(() => { /* refresh is best-effort */ })
            .finally(() => { this.inflight.delete(distro); });
        this.inflight.set(distro, job);
    }

    /**
     * Warm a distro so a subsequent render has real data. Called during session
     * creation (NOT from the render path). The blocking sync probe runs at most
     * once per distro per process; everything else is non-blocking:
     *   - live data already present → nothing.
     *   - persisted data present → seed it live, then refresh async.
     *   - otherwise → one sync probe (cached + persisted), fall back to refresh.
     */
    ensure(distro: string): void {
        if (!distro) return;
        if (isHealthy(this.settled.get(distro))) return;
        if (this.syncDone.has(distro)) {
            this.refreshAsync(distro);
            return;
        }
        this.syncDone.add(distro);
        const persisted = this.persisted.get(distro);
        if (persisted && isHealthy(persisted)) this.settled.set(distro, persisted); // render-ready immediately
        const probe = probeWslSync(distro); // blocking, once per process
        if (probe) {
            this.settled.set(distro, probe);
            this.persisted.set(distro, probe);
            this.persist();
            log?.(`[supermemory:wsl-env] ${distro}: ${JSON.stringify({ osName: probe.osName, uv: probe.uv, shell: probe.shell })}`);
        } else {
            this.refreshAsync(distro);
        }
    }

    /** Pre-warm every installed distro (plugin activation, non-blocking). */
    async prewarm(): Promise<void> {
        let distros: string[];
        try {
            distros = await listDistros();
        } catch {
            return; // wsl.exe unavailable / WSL not installed — fs layer still works
        }
        for (const distro of distros) this.refreshAsync(distro);
    }
}

/** Singleton used by the environment block + the session/created hook. */
const wslEnv = new WslProbeManager();

// ---------------------------------------------------------------------------
// Windows-host detection (non-WSL workspaces)
// ---------------------------------------------------------------------------

/** Detect the Python environment by probing well-known uv locations. */
function detectUv(): string | undefined {
    const candidates = [
        join(homedir(), '.local', 'bin', 'uv.exe'),   // Windows default
        join(homedir(), '.local', 'bin', 'uv'),         // Linux default
        join(homedir(), '.cargo', 'bin', 'uv'),         // cargo install
    ];
    for (const p of candidates) {
        if (existsSync(p)) return 'uv (' + p + ')';
    }
    const pathDirs = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':');
    for (const dir of pathDirs) {
        const uv = join(dir, process.platform === 'win32' ? 'uv.exe' : 'uv');
        if (existsSync(uv)) return 'uv (' + uv + ')';
    }
    return undefined;
}

/**
 * Detect the shell tool this DSH web host actually executes commands with.
 * The active shell executor registers as `ctx.shell`; its constructor name
 * tells us which implementation backs it: PwshLocalExecutor -> pwsh,
 * LocalBashExecutor -> bash.
 */
function shellName(ctx: Context): string {
    const shell = (ctx as { shell?: unknown }).shell;
    if (shell) {
        const impl = (shell as { constructor?: { name?: string } }).constructor?.name ?? '';
        if (impl.includes('Pwsh')) return 'pwsh';
        if (impl.includes('Bash')) return 'bash';
        return impl;
    }
    if (process.env.SHELL?.includes('bash')) return 'Git Bash';
    return process.platform === 'win32' ? 'cmd.exe' : 'sh';
}

// ---------------------------------------------------------------------------
// Public helpers (wired from hooks.ts / index.ts)
// ---------------------------------------------------------------------------

/** Kick off – and if needed synchronously resolve – the WSL probe for a session.
 *  Call from session/created so the render path stays non-blocking. */
export function ensureWslProbe(session: Session): void {
    const cwd = session.header?.cwd ?? '';
    if (!isWslWorkspace(cwd)) return;
    wslEnv.ensure(distroOf(cwd));
}

/** Pre-warm every installed distro on plugin activation (non-blocking). */
export async function prewarmWslProbes(): Promise<void> {
    await wslEnv.prewarm();
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Dynamic environment block (top of the runtime context). Modeled after
 * Cursor's environment header: cwd, git state, platform, shell, OS, python.
 * Order 5 keeps it ABOVE every framework context (110+).
 * For WSL workspaces it reflects the Linux environment instead of win32.
 * Pure read — no probes are triggered here.
 */
export function environmentBlock(ctx: Context, session: Session): string {
    const cwd = session.header?.cwd ?? process.cwd();
    const lines = [
        'Primary working directory: ' + cwd,
        'Is a git repository:      ' + (isGitRepo(cwd) ? 'yes' : 'no'),
    ];

    let uv: string | undefined;
    if (isWslWorkspace(cwd)) {
        const distro = distroOf(cwd);
        const probe = wslEnv.resolve(distro, cwd);
        const probing = wslEnv.isProbing(distro) && !probe.kernel;

        lines.push('Workspace:                WSL (' + distro + ')');
        lines.push('Platform:                 wsl (' + process.platform + ' host)');
        lines.push('Shell:                    ' + (probe.shell || 'bash') + ' (WSL ' + distro + ')');
        const osName = probe.osName || 'Linux';
        lines.push('OS Version:               ' + osName + (probing ? ' (probing…)' : '') + (probe.kernel ? ' (kernel ' + probe.kernel + ')' : ''));
        uv = (probe.uv ? 'uv (' + probe.uv + ')' : undefined)
            ?? (probe.uvx ? 'uvx (' + probe.uvx + ')' : undefined)
            ?? (probe.python ? 'python3 (' + probe.python + ')' : undefined);
    }
    else {
        lines.push('Platform:                 ' + process.platform);
        lines.push('Shell:                    ' + shellName(ctx));
        lines.push('OS Version:               ' + process.platform + ' ' + osRelease());
        uv = detectUv();
    }

    if (uv) lines.push('Python:                   ' + uv);
    return lines.join('\n');
}

/** True when the session cwd is inside a git working tree. */
function isGitRepo(cwd: string): boolean {
    try {
        return existsSync(join(cwd, '.git'));
    }
    catch {
        return false;
    }
}