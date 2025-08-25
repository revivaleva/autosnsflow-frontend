import { postToThreads } from "@/lib/threads";

export async function postReplyViaThreads({
  accessToken,
  providerUserId,
  inReplyTo,
  text,
}: { accessToken: string; providerUserId: string; inReplyTo?: string; text: string; }): Promise<{ postId: string }> {
  const { postId } = await postToThreads({
    accessToken,
    text,
    userIdOnPlatform: providerUserId,
    inReplyTo,
  });
  return { postId: postId ?? "" };
}
