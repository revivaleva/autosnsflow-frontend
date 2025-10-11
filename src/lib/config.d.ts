export declare function loadConfig(): Promise<Record<string, string>>;
export declare function getConfigValue(key: string, fallback?: string): string;
declare const _default: {
    loadConfig: typeof loadConfig;
    getConfigValue: typeof getConfigValue;
};
export default _default;
