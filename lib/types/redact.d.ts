/** Pure secret-masking helpers (dependency-free, unit-testable). */
/**
 * Mask an API key for client-facing responses: the settings card only needs
 * to know whether a key exists (and for the password field's display), never
 * the plaintext — which would otherwise be readable by ANY same-origin script.
 */
export declare function maskApiKey(key: string): string;
