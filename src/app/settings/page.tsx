// app/(protected)/settings/page.tsx
"use client";
import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [values, setValues] = useState<Settings>(DEFAULTS);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/settings", {
          credentials: "include",
          cache: "no-store",
        });
        if (!r.ok) {
          // 401でもここではページ遷移せず、メッセージ表示に留める
          throw new Error(`HTTP ${r.status}`);
        }
        const { settings } = await r.json();
        setValues(settings);
      } catch (e) {
        setError("セッションが無効か権限がありません。もう一度ログインしてください。");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div>読み込み中…</div>;
  if (error) return (
    <div className="p-4">
      <p className="text-red-600">{error}</p>
      <a className="underline" href={`/login?next=${encodeURIComponent("/settings")}`}>ログインへ</a>
    </div>
  );

  return <SettingsForm initialValues={values} />;
}
