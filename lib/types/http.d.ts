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
/** Dispatch every /api route (mounted as a prefix on the dsh web server). */
export declare function handleApi(ctx: Context, scope: SettingsScope<any>, req: IncomingMessage, res: ServerResponse, managed: ManagedServer): Promise<void>;
