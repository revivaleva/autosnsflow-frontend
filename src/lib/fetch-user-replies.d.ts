export declare function fetchUserReplies({ userId, accountId, limit, providerUserId }: {
    userId: string;
    accountId: string;
    limit?: number;
    providerUserId?: string;
}): Promise<any[]>;
export default fetchUserReplies;
