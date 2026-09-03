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

const DATA_OFFSET = 8;
const RESULT_BYTES = 256 * 1024;

export interface SearchHit {
    memory: string;
}

export class SearchWorker {
    private worker: Worker | undefined;
    private sab = new SharedArrayBuffer(DATA_OFFSET + RESULT_BYTES);

    private ensure(): Worker {
        if (this.worker) return this.worker;
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
    search(
        base: string,
        apiKey: string,
        query: string,
        container: string,
        limit: number,
        timeoutMs = 8000,
    ): SearchHit[] {
        const worker = this.ensure();
        const i32 = new Int32Array(this.sab);
        Atomics.store(i32, 0, 0); // idle
        Atomics.store(i32, 1, 0); // clear length
        worker.postMessage({ sab: this.sab, base, apiKey, query, container, limit });
        Atomics.wait(i32, 0, 0, timeoutMs);
        const state = Atomics.load(i32, 0);
        if (state === 3) throw new Error('search worker reported an error');
        if (state !== 2) return []; // timeout / no response
        const n = Atomics.load(i32, 1);
        const bytes = new Uint8Array(this.sab).subarray(DATA_OFFSET, DATA_OFFSET + n);
        const data = JSON.parse(Buffer.from(bytes).toString('utf8')) as {
            memories?: Array<{ memory?: string }>;
            results?: Array<{ memory?: string }>;
        };
        return (data.results ?? data.memories ?? [])
            .map((m) => ({ memory: m.memory ?? '' }))
            .filter((m) => m.memory.length > 0);
    }

    dispose(): void {
        this.worker?.terminate().catch(() => {});
        this.worker = undefined;
    }
}