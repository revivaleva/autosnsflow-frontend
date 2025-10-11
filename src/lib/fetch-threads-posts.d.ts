export declare function fetchThreadsPosts({ userId, accountId, limit }: {
    userId: string;
    accountId: string;
    limit?: number;
}): Promise<{
    id: any;
    shortcode: any;
    timestamp: any;
    text: any;
    replyTo: any;
    referencedPosts: any;
    replyCount: any;
    userIdOnPlatform: any;
    rootId: any;
    raw: any;
}[]>;
export default fetchThreadsPosts;
