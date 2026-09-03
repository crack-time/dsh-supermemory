/**
 * Worker-thread entry for the persistent search worker. Runs the /v4/search HTTP
 * call asynchronously and hands the result back to the main thread over a
 * SharedArrayBuffer + Atomics.notify, so the main thread can block synchronously
 * on the answer (see SearchWorker in search-worker.ts).
 *
 * SAB layout (Int32 words + byte payload):
 *   sab[0]  state: 0 idle / 1 busy / 2 done / 3 error
 *   sab[1]  result byte length (bytes at DATA_OFFSET)
 *   sab[8..]  UTF-8 JSON of the search response
 */
import { parentPort } from 'node:worker_threads';
const DATA_OFFSET = 8;
parentPort?.on('message', (req) => {
    const i32 = new Int32Array(req.sab);
    const bytes = new Uint8Array(req.sab);
    Atomics.store(i32, 0, 1); // busy
    Atomics.store(i32, 1, 0);
    void (async () => {
        try {
            const res = await fetch(req.base + '/v4/search', {
                method: 'POST',
                headers: { authorization: 'Bearer ' + req.apiKey, 'content-type': 'application/json' },
                body: JSON.stringify({ q: req.query, containerTag: req.container, threshold: req.threshold ?? 0.5, limit: req.limit }),
            });
            const text = await res.text();
            const buf = Buffer.from(text, 'utf8');
            const max = req.sab.byteLength - DATA_OFFSET;
            const n = Math.min(buf.length, max);
            bytes.set(buf.subarray(0, n), DATA_OFFSET);
            Atomics.store(i32, 1, n);
            Atomics.store(i32, 0, 2); // done
        }
        catch {
            Atomics.store(i32, 1, 0);
            Atomics.store(i32, 0, 3); // error
        }
        finally {
            Atomics.notify(i32, 0);
        }
    })();
});
