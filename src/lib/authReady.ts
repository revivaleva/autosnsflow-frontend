"use client";

export const AUTH_READY_KEY = "authReady";

export function getAuthReady(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = window.localStorage.getItem(AUTH_READY_KEY);
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}

export function setAuthReady(v: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTH_READY_KEY, v ? "1" : "0");
  } catch {}
}

export async function refreshAuthReady(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    const ok = Boolean(data?.ok);
    setAuthReady(ok);
    return ok;
  } catch {
    setAuthReady(false);
    return false;
  }
}


