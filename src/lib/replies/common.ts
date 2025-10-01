import { postToThreads } from "@/lib/threads";

export async function postReplyViaThreads({
  accessToken,
  providerUserId,
  inReplyTo,
  text,
}: { accessToken: string; providerUserId: string; inReplyTo?: string; text: string; }): Promise<{ postId: string }> {
  const { postId } = await postToThreads({
    accessToken,
    // oauthAccessToken will be looked up by callers if needed; callers that have it can pass it here
    text,
    userIdOnPlatform: providerUserId,
    inReplyTo,
  });
  return { postId: postId ?? "" };
}
