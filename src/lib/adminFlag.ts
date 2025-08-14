// /src/lib/adminFlag.ts
// [ADD] 管理者フラグの保存/取得とサーバ再検証ユーティリティ
"use client";

export const ADMIN_FLAG_KEY = "isAdmin";

export function getAdminFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = window.localStorage.getItem(ADMIN_FLAG_KEY);
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}

export function setAdminFlag(v: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ADMIN_FLAG_KEY, v ? "1" : "0");
  } catch {}
}

export function clearAdminFlag() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ADMIN_FLAG_KEY);
  } catch {}
}

/** サーバ (/api/auth/me) で再判定して localStorage を更新 */
export async function refreshAdminFlag(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/me", {
      credentials: "include",
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    const isAdmin = Boolean(data?.isAdmin);
    setAdminFlag(isAdmin);
    return isAdmin;
  } catch {
    setAdminFlag(false);
    return false;
  }
}

/** ログイン完了直後に呼ぶとベスト（メニュー表示が一発で合う） */
export async function setAdminFlagFromServerOnce(): Promise<boolean> {
  return refreshAdminFlag();
}
