export declare function deleteScheduledRecord({ userId, sk, physical }: {
    userId: string;
    sk: string;
    physical?: boolean;
}): Promise<{
    ok: boolean;
    reason: string;
    physical?: undefined;
} | {
    ok: boolean;
    physical: boolean;
    reason?: undefined;
}>;
