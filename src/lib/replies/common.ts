import { postToThreads } from "@/lib/threads";

export async function postReplyViaThreads({
  accessToken,
  oauthAccessToken,
  providerUserId,
  inReplyTo,
  text,
}: { accessToken?: string; oauthAccessToken?: string; providerUserId: string; inReplyTo?: string; text: string; }): Promise<{ postId: string }> {
  const { postId } = await postToThreads({
    accessToken: accessToken || '',
    oauthAccessToken: oauthAccessToken || undefined,
    text,
    userIdOnPlatform: providerUserId,
    inReplyTo,
  });
  return { postId: postId ?? "" };
}
