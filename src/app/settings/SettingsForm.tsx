// /src/app/settings/SettingsForm.tsx
// [MOD] GETを { settings } に統一して取得。no-store & credentials を常時付与。
//      正規化ロジックは互換キーも吸収。UIは現状のまま。
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
  // [MOD] autoPost: "active" | "inactive" → boolean
  autoPost: boolean;
  doublePostDelay: string; // minutes as string
};

const DEFAULTS: Settings = {
  discordWebhook: "",
  errorDiscordWebhook: "",
  openaiApiKey: "",
  selectedModel: "gpt-3.5-turbo",
  masterPrompt: "",
  replyPrompt: "",
  // [MOD] 既定は false（無効）
  autoPost: false,
  doublePostDelay: "0",
};

export default function SettingsForm() {
  const [values, setValues] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // [MOD] 受け取った settings を UI 用に正規化（autoPost を boolean 化）
  const normalize = (raw?: any): Settings => {
    const src = raw?.settings ?? raw ?? {};

    const list: string[] = Array.isArray(src.discordWebhooks) ? src.discordWebhooks : [];
    const discordWebhook = src.discordWebhook ?? list[0] ?? "";
    const errorDiscordWebhook = src.errorDiscordWebhook ?? list[1] ?? "";
    const openaiApiKey = src.openaiApiKey ?? src.openAiApiKey ?? "";
    const selectedModel = src.selectedModel ?? src.modelDefault ?? DEFAULTS.selectedModel;

    // [ADD] 旧データ（"active"/"inactive" 文字列や "1"/"0"）にも耐えるが保存は boolean に統一
    const toBool = (v: any): boolean => {
      if (typeof v === "boolean") return v;
      if (typeof v === "number") return v !== 0;
      if (typeof v === "string") {
        const s = v.toLowerCase();
        return s === "true" || s === "1" || s === "on" || s === "yes" || s === "active";
      }
      return false;
    };

    return {
      discordWebhook,
      errorDiscordWebhook,
      openaiApiKey,
      selectedModel,
      masterPrompt: src.masterPrompt ?? "",
      replyPrompt: src.replyPrompt ?? "",
      // [MOD] ここを boolean に
      autoPost: toBool(src.autoPost ?? DEFAULTS.autoPost),
      doublePostDelay: String(src.doublePostDelay ?? "0"),
    };
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setMessage(null);
        setError(null);

        const res = await fetch("/api/user-settings", {
          method: "GET",
          credentials: "include",
          // [MOD] 取得が古くならないように
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`GET failed: ${res.status}`);

        const data = await res.json();
        if (!alive) return;
        setValues(prev => ({ ...prev, ...normalize(data) }));
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "設定の取得に失敗しました");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onChange = <K extends keyof Settings>(key: K, v: Settings[K]) => {
    setValues((prev) => ({ ...prev, [key]: v }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/user-settings", {
        // [MOD] 保存は PATCH に統一
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discordWebhook: values.discordWebhook,
          errorDiscordWebhook: values.errorDiscordWebhook,
          openaiApiKey: values.openaiApiKey,
          selectedModel: values.selectedModel,
          masterPrompt: values.masterPrompt,
          replyPrompt: values.replyPrompt,
          // [MOD] boolean のまま送る（"active"/"inactive" は送らない）
          autoPost: values.autoPost,
          doublePostDelay: Number(values.doublePostDelay || 0),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `PATCH failed: ${res.status}`);
      }
      setMessage("保存しました");
    } catch (e: any) {
      setError(e?.message ?? "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };


  if (loading) {
    return <div className="text-gray-600">読込中...</div>;
  }

  return (
    <form onSubmit={onSubmit} className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">ユーザー設定</h1>

      {/* 通知用 Discord Webhook */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          Discord Webhook（通知用）
        </label>
        <input
          type="url"
          value={values.discordWebhook}
          onChange={(e) => onChange("discordWebhook", e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          placeholder="https://discord.com/api/webhooks/..."
        />
        <p className="text-xs text-gray-500">通常の通知を送る先の Webhook URL。</p>
      </div>

      {/* エラー用 Discord Webhook */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          Discord Webhook（エラー用）
        </label>
        <input
          type="url"
          value={values.errorDiscordWebhook}
          onChange={(e) => onChange("errorDiscordWebhook", e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          placeholder="https://discord.com/api/webhooks/..."
        />
        <p className="text-xs text-gray-500">障害や失敗時の通知を送る先。</p>
      </div>

      {/* OpenAI APIキー */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">OpenAI APIキー</label>
        <input
          type="password"
          value={values.openaiApiKey}
          onChange={(e) => onChange("openaiApiKey", e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          placeholder="sk-..."
          autoComplete="new-password"
        />
      </div>

      {/* 既定モデル */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">既定モデル</label>
        <select
          value={values.selectedModel}
          onChange={(e) => onChange("selectedModel", e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2 bg-white"
        >
          <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
          <option value="gpt-4o-mini">gpt-4o-mini</option>
          <option value="gpt-4o">gpt-4o</option>
        </select>
      </div>

      {/* マスタープロンプト */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">マスタープロンプト（投稿生成）</label>
        <textarea
          value={values.masterPrompt}
          onChange={(e) => onChange("masterPrompt", e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2 min-h-[100px]"
          placeholder="投稿生成時のベースとなる指示..."
        />
      </div>

      {/* 返信プロンプト */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">返信プロンプト（自動返信）</label>
        <textarea
          value={values.replyPrompt}
          onChange={(e) => onChange("replyPrompt", e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2 min-h-[100px]"
          placeholder="返信生成時のベースとなる指示..."
        />
      </div>

      {/* 自動投稿 ON/OFF */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">自動投稿</label>
        <select
          value={values.autoPost}
          onChange={(e) => onChange("autoPost", e.target.value as "active" | "inactive")}
          className="w-full rounded border border-gray-300 px-3 py-2 bg-white"
        >
          <option value="active">有効</option>
          <option value="inactive">無効</option>
        </select>
      </div>

      {/* 連投ディレイ（分） */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">連投ディレイ（分）</label>
        <input
          type="number"
          min={0}
          value={values.doublePostDelay}
          onChange={(e) => onChange("doublePostDelay", e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          placeholder="0"
        />
      </div>

      {(message || error) && (
        <div
          className={`rounded px-4 py-3 text-sm ${
            error
              ? "bg-red-50 text-red-700 border border-red-200"
              : "bg-green-50 text-green-700 border border-green-200"
          }`}
        >
          {error ?? message}
        </div>
      )}

      <div className="pt-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </form>
  );
}
