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
export declare const WSL_ROOT_RE: RegExp;
/** Capture the distro name from a WSL UNC path. */
export declare const WSL_DISTRO_RE: RegExp;
/** Capture the \\wsl(<.localhost>)<\distro> prefix for building child paths. */
export declare const WSL_PREFIX_RE: RegExp;
/** Capture …\home\<user> inside a WSL UNC path. */
export declare const WSL_HOME_RE: RegExp;
/** True when a (Windows-host) cwd points inside a WSL distro share. */
export declare function isWslWorkspace(cwd: string): boolean;
/** Extract the distro name from a WSL UNC cwd ('' when not a WSL path). */
export declare function distroOf(cwd: string): string;
/** Convert a WSL UNC file path to its plain Linux form: \\wsl.localhost\Ubuntu\home\a\b → /home/a/b. */
export declare function uncToLinux(p: string): string;
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
export declare function isHealthy(p?: WslProbe): boolean;
/** Normalize a `PRETTY_NAME="..."` line to (value after first `=`), quotes stripped. */
export declare function cleanOsName(line: string): string | undefined;
/** The bash one-liner used to probe a distro.
 *
 * IMPORTANT: this runs via `wsl.exe -- bash -c '<cmd>'`, which is fiddly across
 * the Windows→WSL argv boundary — do NOT source dotfiles, reference a variable
 * whose value contains spaces (e.g. $PRETTY_NAME), or build multi-token values
 * with `command -v`/PATH. Instead use the marker-line format: each `echo`
 * __KEY__ is followed by a plain value line (produced by `test -x … && echo
 * …` / `command -v` / `grep` / `uname`), or an empty line. This survives intact.
 */
export declare function probeScript(): string;
/** Parse the marker-line probe output (each __KEY__ line is followed by a value line). */
export declare function parseProbe(distro: string, out: string): WslProbe;
