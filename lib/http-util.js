/** Send a JSON response with the given status. */
export function sendJson(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(text);
}
/** Read the full request body as text, capped at `maxBytes` (413 on overflow). */
export function readBody(req, maxBytes = 10000000) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk) => {
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
export async function readJsonBody(req) {
    const text = await readBody(req);
    if (!text.trim())
        return {};
    return JSON.parse(text);
}
