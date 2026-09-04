/**
 * Locale dictionary for the Supermemory settings card.
 *
 * Split out of card.tsx so the UI component and the i18n data stay separate:
 * a locale change never touches the component, and the dictionary can also be
 * consumed by tests / other seats without pulling React in.
 */
/** Locale dictionary for the card. */
export declare const CARD_LOCALE: {
    zh: {
        title: string;
        description: string;
        baseUrl: string;
        baseUrlHint: string;
        apiKey: string;
        apiKeyHint: string;
        show: string;
        hide: string;
        save: string;
        saving: string;
        discard: string;
        test: string;
        testing: string;
        unsaved: string;
        saveFailed: string;
        saved: string;
        expand: string;
        collapse: string;
        checkFailed: string;
        ok: string;
        checking: string;
        loadFailed: string;
        emptyKey: string;
        serverPath: string;
        serverPathHint: string;
        reviewProxyPath: string;
        reviewProxyHint: string;
        reviewProxyPort: string;
        openaiApiKey: string;
        openaiBaseUrl: string;
        openaiModel: string;
        managedStatus: string;
        mgtNoPath: string;
        mgtExternal: string;
        mgtRunning: string;
        mgtStarting: string;
        mgtStopped: string;
        mgtMissingExe: string;
        mgtError: string;
        activeContainer: string;
        activeContainerHint: string;
        recallEnabled: string;
        recallEnabledHint: string;
        recallTopK: string;
        recallTopKHint: string;
        recallThreshold: string;
        recallThresholdHint: string;
        loadingContainers: string;
        noContainers: string;
        createNew: string;
        containerStats: string;
        createPlaceholder: string;
    };
    en: {
        title: string;
        description: string;
        baseUrl: string;
        baseUrlHint: string;
        apiKey: string;
        apiKeyHint: string;
        show: string;
        hide: string;
        save: string;
        saving: string;
        discard: string;
        test: string;
        testing: string;
        unsaved: string;
        saveFailed: string;
        saved: string;
        expand: string;
        collapse: string;
        checkFailed: string;
        ok: string;
        checking: string;
        loadFailed: string;
        emptyKey: string;
        serverPath: string;
        serverPathHint: string;
        reviewProxyPath: string;
        reviewProxyHint: string;
        reviewProxyPort: string;
        openaiApiKey: string;
        openaiBaseUrl: string;
        openaiModel: string;
        managedStatus: string;
        mgtNoPath: string;
        mgtExternal: string;
        mgtRunning: string;
        mgtStarting: string;
        mgtStopped: string;
        mgtMissingExe: string;
        mgtError: string;
        activeContainer: string;
        activeContainerHint: string;
        recallEnabled: string;
        recallEnabledHint: string;
        recallTopK: string;
        recallTopKHint: string;
        recallThreshold: string;
        recallThresholdHint: string;
        loadingContainers: string;
        noContainers: string;
        createNew: string;
        containerStats: string;
        createPlaceholder: string;
    };
};
export type CardTextKey = keyof typeof CARD_LOCALE.zh;
