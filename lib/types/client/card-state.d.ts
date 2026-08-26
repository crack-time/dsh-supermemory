import type { CardTextKey } from './card-locale.ts';
export interface CardState {
    baseUrl: string;
    apiKey: string;
    serverPath: string;
    openaiApiKey: string;
    openaiBaseUrl: string;
    openaiModel: string;
    activeContainer: string;
}
export interface ContainerInfo {
    tag: string;
    staticCount: number;
    dynamicCount: number;
}
export interface ManagedStatus {
    enabled?: boolean;
    state?: string;
    pid?: number;
    exe?: string;
    error?: string;
    stderrTail?: string;
}
export interface Status {
    kind: 'ok' | 'err' | 'info';
    text: string;
}
export interface CardHookDeps {
    /** Locale reader (slot-injected namespace binder). */
    t: (key: CardTextKey) => string;
    /** Persist channel (slot-injected); falls back to POST /config. */
    applyPatch?: (patch: Record<string, unknown>) => Promise<{
        ok: boolean;
        error?: string;
    }>;
    /** Default value factory used when nothing is loaded yet. */
    emptyServer?: CardState;
}
/** All state and actions behind the Supermemory settings card. */
export declare function useSupermemoryCard(deps: CardHookDeps): {
    open: boolean;
    loading: boolean;
    baseUrl: string;
    apiKey: string;
    serverPath: string;
    openaiApiKey: string;
    openaiBaseUrl: string;
    openaiModel: string;
    activeContainer: string;
    containers: ContainerInfo[];
    containersLoading: boolean;
    creatingContainer: boolean;
    newContainerName: string;
    managed: ManagedStatus | null;
    server: CardState | null;
    saving: boolean;
    saveFailed: boolean;
    justSaved: boolean;
    testing: boolean;
    status: Status | null;
    loadErr: boolean;
    dirty: boolean;
    mgtText: (m: ManagedStatus | null) => string | null;
    setOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
    setBaseUrl: import("react").Dispatch<import("react").SetStateAction<string>>;
    setApiKey: import("react").Dispatch<import("react").SetStateAction<string>>;
    setServerPath: import("react").Dispatch<import("react").SetStateAction<string>>;
    setOpenaiApiKey: import("react").Dispatch<import("react").SetStateAction<string>>;
    setOpenaiBaseUrl: import("react").Dispatch<import("react").SetStateAction<string>>;
    setOpenaiModel: import("react").Dispatch<import("react").SetStateAction<string>>;
    setActiveContainer: import("react").Dispatch<import("react").SetStateAction<string>>;
    setContainers: import("react").Dispatch<import("react").SetStateAction<ContainerInfo[]>>;
    setContainersLoading: import("react").Dispatch<import("react").SetStateAction<boolean>>;
    setCreatingContainer: import("react").Dispatch<import("react").SetStateAction<boolean>>;
    setNewContainerName: import("react").Dispatch<import("react").SetStateAction<string>>;
    setManaged: import("react").Dispatch<import("react").SetStateAction<ManagedStatus | null>>;
    setSaving: import("react").Dispatch<import("react").SetStateAction<boolean>>;
    setSaveFailed: import("react").Dispatch<import("react").SetStateAction<boolean>>;
    setJustSaved: import("react").Dispatch<import("react").SetStateAction<boolean>>;
    setTesting: import("react").Dispatch<import("react").SetStateAction<boolean>>;
    setStatus: import("react").Dispatch<import("react").SetStateAction<Status | null>>;
    setLoadErr: import("react").Dispatch<import("react").SetStateAction<boolean>>;
    load: () => Promise<void>;
    loadContainers: (force?: boolean) => Promise<void>;
    saveContainer: (tag: string) => Promise<void>;
    commit: () => Promise<void>;
    runTest: () => Promise<void>;
};
