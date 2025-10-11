export declare function getTokenForAccount({ userId, accountId }: {
    userId: string;
    accountId: string;
}): Promise<string | null>;
export declare function deleteThreadsPostWithToken({ postId, token }: {
    postId: string;
    token: string;
}): Promise<{
    ok: boolean;
    status: number;
    body: any;
}>;
export declare function deleteThreadsPost({ postId, accountId, userId }: {
    postId: string;
    accountId: string;
    userId: string;
}): Promise<{
    ok: boolean;
    status: number;
    body: any;
}>;
