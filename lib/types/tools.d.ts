/**
 * AI-facing memory tools registered into the dsh tool runtime. Host-side calls
 * with the configured Bearer key — the model never sees credentials and
 * nothing crosses the browser origin. Container discovery shares
 * discoverContainers (the settings card is the single switch path).
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
/** Register every AI-facing memory tool into the dsh tool runtime. */
export declare function registerMemoryTools(ctx: Context, scope: SettingsScope<any>): Array<() => void>;
