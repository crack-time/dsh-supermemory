/** Pure secret-masking helpers (dependency-free, unit-testable). */
/**
 * Mask an API key for client-facing responses: the settings card only needs
 * to know whether a key exists (and for the password field's display), never
 * the plaintext — which would otherwise be readable by ANY same-origin script.
 */
export function maskApiKey(key) {
    if (!key)
        return '';
    if (key.length <= 8)
        return '****';
    return key.slice(0, 4) + '****' + key.slice(-4);
}
