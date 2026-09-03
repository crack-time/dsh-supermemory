/**
 * Persistent search worker client. Spawns ONE worker thread (on first use) that
 * performs the local /v4/search HTTP call concurrently; the caller searches
 * SYNCHRONOUSLY by blocking on a SharedArrayBuffer via Atomics.wait until the
 * worker signals completion. This gives deterministic recall (the cache is
 * populated before prompt assembly) without the per-message process-spawn cost
 * of an execFileSync fallback.
 *
 * Atomics.wait is legal on Node's main thread, so this integrates directly into
 * the synchronous `user/message` event handler.
 */
import { Worker } from 'node:worker_threads';
import { filterSearchHits } from './recall.js';
const DATA_OFFSET = 8;
const RESULT_BYTES = 256 * 1024;
export class SearchWorker {
    worker;
    sab = new SharedArrayBuffer(DATA_OFFSET + RESULT_BYTES);
    ensure() {
        if (this.worker)
            return this.worker;
        const url = new URL('./search-worker-entry.js', import.meta.url);
        const worker = new Worker(url);
        worker.once('error', () => { this.worker = undefined; });
        worker.once('exit', () => { this.worker = undefined; });
        this.worker = worker;
        return worker;
    }
    /**
     * Synchronously search. Blocks the calling (main) thread up to `timeoutMs`
     * while the worker performs the fetch. Returns the hits, or throws on a
     * hard failure (worker gone / error state) so the caller can fall back.
     */
    search(base, apiKey, query, container, limit, threshold = 0.5, timeoutMs = 8000) {
        const worker = this.ensure();
        const i32 = new Int32Array(this.sab);
        Atomics.store(i32, 0, 0); // idle
        Atomics.store(i32, 1, 0); // clear length
        worker.postMessage({ sab: this.sab, base, apiKey, query, container, limit, threshold });
        Atomics.wait(i32, 0, 0, timeoutMs);
        const state = Atomics.load(i32, 0);
        if (state === 3)
            throw new Error('search worker reported an error');
        if (state !== 2)
            return []; // timeout / no response
        const n = Atomics.load(i32, 1);
        const bytes = new Uint8Array(this.sab).subarray(DATA_OFFSET, DATA_OFFSET + n);
        const data = JSON.parse(Buffer.from(bytes).toString('utf8'));
        return filterSearchHits(data.results ?? data.memories ?? [], threshold);
    }
    dispose() {
        this.worker?.terminate().catch(() => { });
        this.worker = undefined;
    }
}
