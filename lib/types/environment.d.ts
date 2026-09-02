import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
/** True when a (Windows-host) cwd points inside a WSL distro share. */
export declare function isWslWorkspace(cwd: string): boolean;
/** Extract the distro name from a WSL UNC cwd ('' when not a WSL path). */
export declare function distroOf(cwd: string): string;
/** What we know about a WSL distro's toolchain. */
export interface WslProbe {
    distro: string;
    /** Linux username (uid 0-owner). */
    user?: string;
    /** Linux home directory, e.g. /home/crack. */
    home?: string;
    /** $SHELL basename inside the distro, e.g. bash. */
    shell: string;
    /** `command -v uv` result (or a well-known fallback), e.g. /home/crack/.local/bin/uv. */
    uv?: string;
    /** `command -v uvx` result. */
    uvx?: string;
    /** `command -v python3` result. */
    python?: string;
    /** distro pretty name, e.g. "Ubuntu 22.04.4 LTS". */
    osName?: string;
    /** Linux kernel release, e.g. 5.15.153.1-microsoft-standard-WSL2. */
    kernel?: string;
}
export declare function setProbeLog(fn?: (m: string) => void): void;
/**
 * Pre-warm every installed distro on plugin activation so WSL environment
 * blocks render from settled data on the first model step of a WSL session.
 * No-op when WSL is unavailable or distros are gone.
 */
export declare function prewarmWslProbes(): Promise<void>;
/**
 * Kick off the WSL probe for a session (fire-and-forget, per distro). No-op
 * when the workspace is not WSL or the distro already has good data.
 */
export declare function kickOffEnvironmentProbe(session: Session): void;
/**
 * Dynamic environment block (top of the runtime context). Modeled after
 * Cursor's environment header: cwd, git state, platform, shell, OS, python.
 * Order 5 keeps it ABOVE every framework context (110+).
 * For WSL workspaces it reflects the Linux environment instead of win32.
 */
export declare function environmentBlock(ctx: Context, session: Session): string;
