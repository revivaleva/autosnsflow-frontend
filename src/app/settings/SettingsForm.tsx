// /src/app/settings/SettingsForm.tsx

"use client";

import { useEffect, useState } from "react";

export default function SettingsForm() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 既存項目（例）
  const [discordWebhooks, setDiscordWebhooks] = useState<string>("");
  const [planType, setPlanType] = useState<string>("free");

  // [ADD] 読み取り専用で表示したい場合のみ保持（編集UIは出さない）
  const [roDailyOpenAiLimit, setRoDailyOpenAiLimit] = useState<number | null>(null);
  const [roDefaultOpenAiCost, setRoDefaultOpenAiCost] = useState<number | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/api/user-settings");
        const data = await res.json();

        setDiscordWebhooks((data.discordWebhooks || []).join("\n"));
        setPlanType(data.planType || "free");

        // [ADD] 読み取り専用値の取得（APIは返却のみ）
        setRoDailyOpenAiLimit(
          typeof data.dailyOpenAiLimit === "number" ? data.dailyOpenAiLimit : null
        );
        setRoDefaultOpenAiCost(
          typeof data.defaultOpenAiCost === "number" ? data.defaultOpenAiCost : null
        );
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        discordWebhooks: discordWebhooks
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        planType,
        // [DEL] 上限値は管理画面からのみ更新可能にしたため送信しない
        // dailyOpenAiLimit, defaultOpenAiCost
      };
      const res = await fetch("/api/user-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t);
      }
      alert("保存しました");
    } catch (e: any) {
      alert(`保存に失敗しました: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-sm text-gray-500">読み込み中...</div>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6 p-4 max-w-3xl">
      {/* 既存: Discord Webhook */}
      <div>
        <label className="block text-sm font-medium mb-1">Discord Webhook URLs</label>
        <textarea
          className="w-full rounded-md border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          rows={4}
          value={discordWebhooks}
          onChange={(e) => setDiscordWebhooks(e.target.value)}
          placeholder="1行に1URL"
        />
        <p className="mt-1 text-xs text-gray-500">1行に1つずつ入力してください。</p>
      </div>

      {/* 既存: プラン */}
      <div>
        <label className="block text-sm font-medium mb-1">プラン</label>
        <select
          className="w-56 rounded-md border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={planType}
          onChange={(e) => setPlanType(e.target.value)}
        >
          <option value="free">free</option>
          <option value="premium">premium</option>
        </select>
      </div>

      {/* [ADD] 読み取り専用の参考表示（任意） */}
      {roDailyOpenAiLimit !== null && (
        <div className="rounded-md border border-gray-200 p-3 bg-gray-50">
          <p className="text-sm text-gray-700">
            OpenAI日次上限（参照のみ）: <span className="font-medium">{roDailyOpenAiLimit}</span>
          </p>
          <p className="mt-1 text-xs text-gray-500">
            ※ 上限の変更は管理者にお問い合わせください。
          </p>
        </div>
      )}

      <button
        type="submit"
        disabled={saving}
        className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
      >
        {saving ? "保存中..." : "保存する"}
      </button>
    </form>
  );
}
