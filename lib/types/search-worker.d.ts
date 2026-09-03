export interface SearchHit {
    memory: string;
}
export declare class SearchWorker {
    private worker;
    private sab;
    private ensure;
    /**
     * Synchronously search. Blocks the calling (main) thread up to `timeoutMs`
     * while the worker performs the fetch. Returns the hits, or throws on a
     * hard failure (worker gone / error state) so the caller can fall back.
     */
    search(base: string, apiKey: string, query: string, container: string, limit: number, timeoutMs?: number): SearchHit[];
    dispose(): void;
}
