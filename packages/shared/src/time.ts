// /packages/shared/src/time.ts
// JSTのユーティリティ（クライアント/サーバ両用）
export const JST_TZ = "Asia/Tokyo";

export const toUnixSec = (d = new Date()) => Math.floor(d.getTime() / 1000);

// 2段階投稿の遅延分をミニッツで加算してISO返却
export function addMinutesISO(base: Date, minutes: number): string {
  const dt = new Date(base.getTime() + minutes * 60 * 1000);
  return dt.toISOString();
}
