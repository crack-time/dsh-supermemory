/**
 * Tiny shared HTTP helpers for the dsh-side API surface. Kept separate from
 * the route logic so both http.ts (this plugin) and sibling plugins (e.g.
 * @crack/dsh-wsl) can reuse one implementation instead of copying it.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
/** Send a JSON response with the given status. */
export declare function sendJson(res: ServerResponse, status: number, body: unknown): void;
/** Read the full request body as text, capped at `maxBytes` (413 on overflow). */
export declare function readBody(req: IncomingMessage, maxBytes?: number): Promise<string>;
/** Read + JSON-parse a request body; an empty body becomes {}. Parse errors propagate. */
export declare function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>>;
