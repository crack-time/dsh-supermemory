/** True for a child agent session (spawned subagent, no direct injection). */
export function isSubagent(session) {
    return session.header.origin === 'subagent'
        || (session.header.delegationDepth ?? 0) > 0;
}
