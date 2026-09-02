/**
 * Pure WSL path + probe helpers. No node imports — trivially unit-testable and
 * dependency-free, so tests can import the compiled copy without pulling in the
 * cordis/dsh packages. environment.ts uses these; keep them side-effect free.
 *
 * The script + parser are the exact contract that must survive the
 * Windows→wsl.exe argv boundary (see probeScript): a marker line `__KEY__`
 * followed by a plain value line. Regressions here = wrong WSL data in the
 * injected environment block, so these are covered by node:test in test/.
 */
/** Match \\wsl.localhost\<distro>\... or the legacy \\wsl$\<distro>\... */
export const WSL_ROOT_RE = /^\\\\wsl(?:\.localhost)?\$?\\/i;
/** Capture the distro name from a WSL UNC path. */
export const WSL_DISTRO_RE = /^\\\\wsl(?:\.localhost)?\$?\\([^\\]+)/i;
/** Capture the \\wsl(<.localhost>)<\distro> prefix for building child paths. */
export const WSL_PREFIX_RE = /^(\\\\wsl(?:\.localhost)?\$?\\[^\\]+)/i;
/** Capture …\home\<user> inside a WSL UNC path. */
export const WSL_HOME_RE = /^(\\\\wsl(?:\.localhost)?\$?\\[^\\]+\\home\\[^\\]+)/i;
/** True when a (Windows-host) cwd points inside a WSL distro share. */
export function isWslWorkspace(cwd) {
    return WSL_ROOT_RE.test(cwd);
}
/** Extract the distro name from a WSL UNC cwd ('' when not a WSL path). */
export function distroOf(cwd) {
    return cwd.match(WSL_DISTRO_RE)?.[1] ?? '';
}
/** Convert a WSL UNC file path to its plain Linux form: \\wsl.localhost\Ubuntu\home\a\b → /home/a/b. */
export function uncToLinux(p) {
    const m = p.match(/^\\\\wsl(?:\.localhost)?\$?\\[^\\]+\\?(.*)$/i);
    if (!m)
        return p;
    return '/' + (m[1] ?? '').split('\\').filter(Boolean).join('/');
}
/** A probe "carries signal" once it has any real toolchain/distro data. */
export function isHealthy(p) {
    return Boolean(p && (p.osName || p.uv || p.uvx || p.python || p.kernel));
}
/** Normalize a `PRETTY_NAME="..."` line to (value after first `=`), quotes stripped. */
export function cleanOsName(line) {
    const eq = line.indexOf('=');
    const raw = eq >= 0 ? line.slice(eq + 1).trim() : line.trim();
    const stripped = raw.replace(/^["']/, '').replace(/["']$/, '');
    return stripped || undefined;
}
/** The bash one-liner used to probe a distro.
 *
 * IMPORTANT: this runs via `wsl.exe -- bash -c '<cmd>'`, which is fiddly across
 * the Windows→WSL argv boundary — do NOT source dotfiles, reference a variable
 * whose value contains spaces (e.g. $PRETTY_NAME), or build multi-token values
 * with `command -v`/PATH. Instead use the marker-line format: each `echo`
 * __KEY__ is followed by a plain value line (produced by `test -x … && echo
 * …` / `command -v` / `grep` / `uname`), or an empty line. This survives intact.
 */
export function probeScript() {
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
export function parseProbe(distro, out) {
    const probe = { distro, shell: 'bash' };
    const lines = out.split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
        const m = lines[i].match(/^__([A-Z0-9_]+)__$/);
        if (!m) {
            i += 1;
            continue;
        }
        const key = m[1].toLowerCase();
        i += 1;
        const value = (i < lines.length ? lines[i].trim() : '');
        i += 1;
        if (!value)
            continue;
        switch (key) {
            case 'uvx':
                if (!probe.uv && !probe.uvx)
                    probe.uvx = value;
                break;
            case 'uv':
            case 'uvl':
            case 'uvc':
                if (!probe.uv)
                    probe.uv = value;
                break;
            case 'py':
                if (!probe.python)
                    probe.python = value;
                break;
            case 'sh':
                probe.shell = value;
                break;
            case 'os':
                probe.osName = cleanOsName(value) || probe.osName;
                break;
            case 'kernel':
                probe.kernel = value;
                break;
            default: break;
        }
    }
    if (probe.shell.includes('/'))
        probe.shell = probe.shell.split('/').pop() ?? probe.shell;
    return probe;
}
