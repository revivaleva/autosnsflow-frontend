export declare const env: {
    readonly AWS_REGION: string;
    readonly COGNITO_USER_POOL_ID: string;
    readonly COGNITO_CLIENT_ID: string;
    readonly ADMIN_GROUP: string;
    readonly AUTOSNSFLOW_ACCESS_KEY_ID: string;
    readonly AUTOSNSFLOW_SECRET_ACCESS_KEY: string;
};
export declare function getEnvVar(name: string): string | undefined;
export type ClientEnvStatus = {
    ok: boolean;
    missing: string[];
    values: Record<string, string>;
    preview: {
        clientIdHead: string;
        userPoolIdHead: string;
        region: string;
    };
    previewEnabled: boolean;
};
export declare function getClientEnvStatus(): ClientEnvStatus;
