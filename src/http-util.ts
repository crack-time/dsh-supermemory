/**
 * Tiny shared HTTP helpers for the dsh-side API surface. Kept separate from
 * the route logic so both http.ts (this plugin) and sibling plugins (e.g.
 * @crack/dsh-wsl) can reuse one implementation instead of copying it.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Send a JSON response with the given status. */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(text);
}

/** Read the full request body as text, capped at `maxBytes` (413 on overflow). */
export function readBody(req: IncomingMessage, maxBytes = 10_000_000): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk: Buffer | string) => {
            data += String(chunk);
            if (data.length > maxBytes) {
                reject(Object.assign(new Error('request body too large'), { code: 413 }));
                req.destroy();
            }
        });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

/** Read + JSON-parse a request body; an empty body becomes {}. Parse errors propagate. */
export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const text = await readBody(req);
    if (!text.trim()) return {};
    return JSON.parse(text) as Record<string, unknown>;
}