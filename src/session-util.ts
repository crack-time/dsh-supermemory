/**
 * Shared session classification helpers used across the plugin's host half
 * (context injection + session hooks). Kept dependency-free so any module may
 * import it without pulling in subsystem code.
 */
import type { Session } from '@deepseek-ai/dsh-session';

/** True for a child agent session (spawned subagent, no direct injection). */
export function isSubagent(session: Session): boolean {
    return session.header.origin === 'subagent'
        || (session.header.delegationDepth ?? 0) > 0;
}