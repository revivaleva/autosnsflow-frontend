// /packages/backend-core/src/services/discord.ts
// fetch は Node.js 20 でグローバルに利用可能
export async function postDiscord(urls: string[], content: string): Promise<void> {
  for (const url of urls) {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Discord送信失敗: ${resp.status} ${text}`);
    }
  }
}
