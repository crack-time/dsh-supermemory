/**
 * HTTP surface: the dsh-side reverse proxy, health probe and the /api routes
 * (config read/write, container list). The browser never sees the api key —
 * it is injected Host-side on every upstream call.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
import type { ManagedServer } from './managed-server.ts';
export declare const API_PREFIX = "/plugins/@crack/dsh-supermemory/api";
export declare function sendJson(res: ServerResponse, status: number, body: unknown): void;
export declare function readBody(req: IncomingMessage): Promise<string>;
/**
 * Mask an API key for client-facing responses: the settings card only needs
 * to know whether a key exists (and for the password field's display), never
 * the plaintext — which would otherwise be readable by ANY same-origin script
 * through GET /config. Internal callers keep using resolveConfig() and are
 * unaffected.
 */
export declare function maskApiKey(key: string): string;
/** Dispatch every /api route (mounted as a prefix on the dsh web server). */
export declare function handleApi(ctx: Context, scope: SettingsScope<any>, req: IncomingMessage, res: ServerResponse, managed: ManagedServer): Promise<void>;
