export type ExecutionLogEntry = {
    userId?: string;
    accountId?: string;
    action: string;
    status: 'info' | 'error' | 'warn' | string;
    message?: string;
    detail?: any;
    initiatedBy?: string;
    deletedCount?: number;
    targetId?: string;
};
export declare function putLog(entry: ExecutionLogEntry): Promise<void>;
export declare function logEvent(type: string, detail?: any): Promise<void>;
