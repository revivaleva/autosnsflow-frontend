// /src/app/settings/SettingsForm.tsx
"use client";

import { useEffect, useState } from "react";

// ……冒頭の型定義付近……
type Settings = {
  discordWebhook: string;
  errorDiscordWebhook: string;
  openaiApiKey: string;
  selectedModel: string;
  masterPrompt: string;
  replyPrompt: string;
  // [MOD] autoPost: boolean（既定 false）
  autoPost: boolean;
  doublePostDelay: string; // minutes as string
};

const DEFAULTS: Settings = {
  discordWebhook: "",
  errorDiscordWebhook: "",
  openaiApiKey: "",
  selectedModel: "gpt-5-mini",
  masterPrompt: "",
  replyPrompt: "",
  autoPost: false,
  doublePostDelay: "5",
};

export default function SettingsForm() {
  const [values, setValues] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // [KEEP] 設定読み込み
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/user-settings", { method: "GET", credentials: "include", cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          const s = j?.settings || j || {};
          setValues({
            discordWebhook: s.discordWebhook ?? "",
            errorDiscordWebhook: s.errorDiscordWebhook ?? "",
            openaiApiKey: s.openaiApiKey ?? "",
            selectedModel: s.selectedModel ?? "gpt-5-mini",
            masterPrompt: s.masterPrompt ?? "",
            replyPrompt: s.replyPrompt ?? "",
            autoPost: !!s.autoPost,
            doublePostDelay: String(s.doublePostDelay ?? "5"),
          });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const onSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const r = await fetch("/api/user-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(values),
      });
      if (!r.ok) throw new Error("保存に失敗しました");
      setMessage("保存しました");
    } catch (e: any) {
      setMessage(e?.message || "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6 text-gray-500">読み込み中...</div>;

  return (
    <div className="px-6 pb-10">
      {/* [DEL] ここに見出し「ユーザー設定」を出していた場合は削除
          重複を防ぐため、ページ側（/src/app/settings/page.tsx）だけで表示します */}
      <div className="grid gap-6 max-w-3xl">
        <div>
          <label className="block text-sm text-gray-600">Discord Webhook（通知用）</label>
          <input
            className="mt-1 w-full border rounded-md px-3 py-2"
            value={values.discordWebhook}
            onChange={(e) => setValues({ ...values, discordWebhook: e.target.value })}
          />
          {/* 単一Webhookのみサポート（複数は廃止） */}
        </div>

        <div>
          <label className="block text-sm text-gray-600">Discord Webhook（エラー用）</label>
          <input
            className="mt-1 w-full border rounded-md px-3 py-2"
            value={values.errorDiscordWebhook}
            onChange={(e) => setValues({ ...values, errorDiscordWebhook: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-600">OpenAI APIキー</label>
          <input
            className="mt-1 w-full border rounded-md px-3 py-2 dark:bg-gray-800 dark:text-gray-100"
            type="password"
            value={values.openaiApiKey}
            onChange={(e) => setValues({ ...values, openaiApiKey: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-600">既定モデル</label>
          <select
            className="mt-1 w-full border rounded-md px-3 py-2"
            value={values.selectedModel}
            onChange={(e) => setValues({ ...values, selectedModel: e.target.value })}
          >
            <option value="gpt-4o-mini">gpt-4o-mini</option>
            <option value="gpt-4o-nano">gpt-4o-nano</option>
            <option value="gpt-5-mini">gpt-5-mini</option>
            <option value="gpt-5-nano">gpt-5-nano</option>
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-600">マスタープロンプト（投稿生成）</label>
          <textarea
            className="mt-1 w-full min-h-[140px] border rounded-md px-3 py-2"
            value={values.masterPrompt}
            onChange={(e) => setValues({ ...values, masterPrompt: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-600">返信プロンプト（自動返信）</label>
          <textarea
            className="mt-1 w-full min-h-[140px] border rounded-md px-3 py-2"
            value={values.replyPrompt}
            onChange={(e) => setValues({ ...values, replyPrompt: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-600">自動投稿</label>
            <select
              className="mt-1 w-full border rounded-md px-3 py-2"
              value={values.autoPost ? "active" : "inactive"}
              onChange={(e) => setValues({ ...values, autoPost: e.target.value === "active" })}
            >
              <option value="active">有効</option>
              <option value="inactive">無効</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600">連投ディレイ（分）</label>
            <input
              className="mt-1 w-full border rounded-md px-3 py-2"
              type="number"
              min={0}
              value={values.doublePostDelay}
              onChange={(e) => setValues({ ...values, doublePostDelay: e.target.value })}
            />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={onSave}
            disabled={saving}
            className="bg-blue-600 text-white rounded px-5 py-2 hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? "保存中..." : "保存"}
          </button>
          {message && <span className="text-sm text-gray-600">{message}</span>}
        </div>
      </div>
    </div>
  );
}
