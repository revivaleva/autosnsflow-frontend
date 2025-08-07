// src/ui-components/SettingsForm.jsx

"use client";

import React, { useEffect, useState } from "react";

const modelOptions = [
  "gpt-3.5-turbo",
  "gpt-4o",
  "gpt-4-turbo",
  "gpt-4",
  "gpt-4o-mini",
];

const autoPostOptions = [
  { value: "active", label: "稼働" },
  { value: "inactive", label: "停止" },
];

export default function SettingsForm() {
  const [discordWebhook, setDiscordWebhook] = useState("");
  const [errorDiscordWebhook, setErrorDiscordWebhook] = useState("");
  const [openaiApiKey, setOpenAiApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState(modelOptions[0]);
  const [masterPrompt, setMasterPrompt] = useState("");
  const [replyPrompt, setReplyPrompt] = useState("");
  const [autoPost, setAutoPost] = useState("active");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  // 設定情報の取得
  useEffect(() => {
    const userId = localStorage.getItem("userId");
    if (!userId) return;
    fetch(`/api/user-settings?userId=${userId}`)
      .then(res => res.json())
      .then(data => {
        if (data) {
          setDiscordWebhook(data.discordWebhook || "");
          setErrorDiscordWebhook(data.errorDiscordWebhook || "");
          setOpenAiApiKey(data.openaiApiKey || "");
          setSelectedModel(data.selectedModel || modelOptions[0]);
          setMasterPrompt(data.masterPrompt || "");
          setReplyPrompt(data.replyPrompt || "");
          setAutoPost(data.autoPost || "active");
        }
      });
  }, []);

  // 保存処理
  const handleSave = async () => {
    setSaving(true);
    setSaveMessage("");
    const userId = localStorage.getItem("userId");
    const res = await fetch("/api/user-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        discordWebhook,
        errorDiscordWebhook,
        openaiApiKey,
        selectedModel,
        masterPrompt,
        replyPrompt,
        autoPost,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (data.success) {
      setSaveMessage("保存しました！");
      setTimeout(() => setSaveMessage(""), 2000);
    } else {
      setSaveMessage(data.error || "保存に失敗しました");
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded-xl shadow">
      <h2 className="text-xl font-bold mb-6">設定</h2>
      <form
        autoComplete="off"
        onSubmit={e => {
          e.preventDefault();
          handleSave();
        }}
      >
        <div className="space-y-4">
          <div>
            <label className="font-semibold block mb-1">DiscordWebhook</label>
            <input
              type="text"
              className="w-full border rounded p-2"
              value={discordWebhook}
              onChange={e => setDiscordWebhook(e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
              autoComplete="off"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">エラー通知DiscordWebhook</label>
            <input
              type="text"
              className="w-full border rounded p-2"
              value={errorDiscordWebhook}
              onChange={e => setErrorDiscordWebhook(e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
              autoComplete="off"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">OpenAI API キー</label>
            <input
              type="new-password"
              className="w-full border rounded p-2"
              value={openaiApiKey}
              onChange={e => setOpenAiApiKey(e.target.value)}
              placeholder="sk-..."
              autoComplete="off"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">使用モデル</label>
            <select
              className="w-full border rounded p-2"
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              autoComplete="off"
            >
              {modelOptions.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="font-semibold block mb-1">マスタープロンプト</label>
            <textarea
              className="w-full border rounded p-2"
              rows={3}
              value={masterPrompt}
              onChange={e => setMasterPrompt(e.target.value)}
              placeholder="マスタープロンプトを入力"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">リプライプロンプト</label>
            <textarea
              className="w-full border rounded p-2"
              rows={3}
              value={replyPrompt}
              onChange={e => setReplyPrompt(e.target.value)}
              placeholder="リプライプロンプトを入力"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="font-semibold block mb-1">自動投稿</label>
            <select
              className="w-full border rounded p-2"
              value={autoPost}
              onChange={e => setAutoPost(e.target.value)}
              autoComplete="off"
            >
              {autoPostOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-8 flex justify-end items-center space-x-3">
          {saveMessage && <span className="text-green-600">{saveMessage}</span>}
          <button
            type="submit"
            className="bg-blue-500 text-white px-6 py-2 rounded hover:bg-blue-600 disabled:opacity-50"
            disabled={saving}
            autoComplete="off"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}
