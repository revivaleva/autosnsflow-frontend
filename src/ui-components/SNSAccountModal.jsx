// src/ui-components/SNSAccountModal.jsx
import React, { useState, useEffect } from "react";

const platformOptions = [
  { value: "twitter", label: "Twitter" },
  { value: "threads", label: "Threads" },
  { value: "both", label: "両方" },
];

// ダミー：グループ選択肢
const dummyGroups = [
  { id: "g1", name: "朝投稿グループ" },
  { id: "g2", name: "夜投稿グループ" },
];

export default function SNSAccountModal({ open, onClose, mode = "create", account }) {
  const [platform, setPlatform] = useState("twitter");
  const [twitterId, setTwitterId] = useState("");
  const [threadsId, setThreadsId] = useState("");
  const [twitterClientId, setTwitterClientId] = useState("");
  const [twitterClientSecret, setTwitterClientSecret] = useState("");
  const [threadsAccessToken, setThreadsAccessToken] = useState("");
  const [personaTemplate, setPersonaTemplate] = useState(""); // テンプレ読込
  const [groupId, setGroupId] = useState(""); // 投稿グループ

  // ペルソナ
  const [persona, setPersona] = useState({
    name: "",
    age: "",
    gender: "",
    job: "",
    lifestyle: "",
    character: "",
    tone: "",
    vocab: "",
    emotion: "",
    erotic: "",
    target: "",
    purpose: "",
    distance: "",
    ng: "",
  });

  // 編集時は初期値セット
  useEffect(() => {
    if (mode === "edit" && account) {
      setPlatform(account.platform === "両方" ? "both" : account.platform?.toLowerCase());
      setTwitterId(account.twitterId || "");
      setThreadsId(account.threadsId || "");
      setTwitterClientId(account.twitterClientId || "");
      setTwitterClientSecret(account.twitterClientSecret || "");
      setThreadsAccessToken(account.threadsAccessToken || "");
      setGroupId(account.groupId || "");
      setPersona(account.persona || {});
    }
  }, [account, mode]);

  // プラットフォーム選択
  const handlePlatformChange = e => setPlatform(e.target.value);

  // ペルソナ入力
  const handlePersonaChange = e =>
    setPersona({ ...persona, [e.target.name]: e.target.value });

  // テンプレ・複製用UIダミー
  const handleLoadTemplate = () => {
    setPersona({
      ...persona,
      name: "テンプレ名前",
      job: "エンジニア",
      // ...ほか適当な値
    });
  };

  // 登録・保存ダミー
  const handleSubmit = e => {
    e.preventDefault();
    alert("登録/保存はダミー");
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
      <form
        className="bg-white p-8 rounded shadow-lg min-w-[600px] max-h-[90vh] overflow-y-auto relative"
        onSubmit={handleSubmit}
      >
        <button type="button" className="absolute top-2 right-2 text-gray-400" onClick={onClose}>×</button>
        <h2 className="text-xl font-bold mb-4">{mode === "edit" ? "アカウント編集" : "新規アカウント追加"}</h2>

        {/* プラットフォーム */}
        <label className="block mb-2 font-semibold">プラットフォーム</label>
        <select className="mb-4 border px-2 py-1 rounded w-full"
          value={platform}
          onChange={handlePlatformChange}
        >
          {platformOptions.map(opt =>
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          )}
        </select>

        {/* アカウントID */}
        {(platform === "twitter" || platform === "both") && (
          <>
            <label className="block">TwitterアカウントID</label>
            <input
              className="mb-2 border rounded px-2 py-1 w-full"
              value={twitterId}
              onChange={e => setTwitterId(e.target.value)}
            />
          </>
        )}
        {(platform === "threads" || platform === "both") && (
          <>
            <label className="block">ThreadsアカウントID</label>
            <input
              className="mb-2 border rounded px-2 py-1 w-full"
              value={threadsId}
              onChange={e => setThreadsId(e.target.value)}
            />
          </>
        )}

        {/* 各プラットフォームごとの認証情報 */}
        {platform !== "threads" && (
          <>
            <label className="block">Twitter Client ID</label>
            <input className="mb-2 border rounded px-2 py-1 w-full"
              value={twitterClientId}
              onChange={e => setTwitterClientId(e.target.value)}
            />
            <label className="block">Twitter Client Secret</label>
            <input className="mb-2 border rounded px-2 py-1 w-full"
              value={twitterClientSecret}
              onChange={e => setTwitterClientSecret(e.target.value)}
            />
          </>
        )}
        {platform !== "twitter" && (
          <>
            <label className="block">Threads アクセストークン</label>
            <input className="mb-2 border rounded px-2 py-1 w-full"
              value={threadsAccessToken}
              onChange={e => setThreadsAccessToken(e.target.value)}
            />
          </>
        )}

        {/* ペルソナテンプレ・複製 */}
        <div className="my-3 flex gap-2">
          <button type="button" className="border px-2 py-1 rounded bg-gray-100" onClick={handleLoadTemplate}>
            テンプレート読込
          </button>
          <button type="button" className="border px-2 py-1 rounded bg-gray-100">
            既存アカウント複製
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 mb-3">
          <input className="border px-2 py-1 rounded" name="name" value={persona.name} onChange={handlePersonaChange} placeholder="名前" />
          <input className="border px-2 py-1 rounded" name="age" value={persona.age} onChange={handlePersonaChange} placeholder="年齢" />
          <input className="border px-2 py-1 rounded" name="gender" value={persona.gender} onChange={handlePersonaChange} placeholder="性別" />
          <input className="border px-2 py-1 rounded" name="job" value={persona.job} onChange={handlePersonaChange} placeholder="職業" />
          <input className="border px-2 py-1 rounded" name="lifestyle" value={persona.lifestyle} onChange={handlePersonaChange} placeholder="生活スタイル" />
          <input className="border px-2 py-1 rounded" name="character" value={persona.character} onChange={handlePersonaChange} placeholder="投稿キャラ" />
          <input className="border px-2 py-1 rounded" name="tone" value={persona.tone} onChange={handlePersonaChange} placeholder="口調・内面" />
          <input className="border px-2 py-1 rounded" name="vocab" value={persona.vocab} onChange={handlePersonaChange} placeholder="語彙傾向" />
          <input className="border px-2 py-1 rounded" name="emotion" value={persona.emotion} onChange={handlePersonaChange} placeholder="感情パターン" />
          <input className="border px-2 py-1 rounded" name="erotic" value={persona.erotic} onChange={handlePersonaChange} placeholder="エロ表現" />
          <input className="border px-2 py-1 rounded" name="target" value={persona.target} onChange={handlePersonaChange} placeholder="ターゲット層" />
          <input className="border px-2 py-1 rounded" name="purpose" value={persona.purpose} onChange={handlePersonaChange} placeholder="投稿目的" />
          <input className="border px-2 py-1 rounded" name="distance" value={persona.distance} onChange={handlePersonaChange} placeholder="絡みの距離感" />
          <input className="border px-2 py-1 rounded" name="ng" value={persona.ng} onChange={handlePersonaChange} placeholder="NG要素" />
        </div>

        {/* 自動投稿グループ */}
        <label className="block">自動投稿グループ</label>
        <select className="mb-4 border px-2 py-1 rounded w-full" value={groupId} onChange={e => setGroupId(e.target.value)}>
          <option value="">選択してください</option>
          {dummyGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>

        <div className="text-right mt-6">
          <button
            type="submit"
            className="bg-blue-500 text-white rounded px-5 py-2 hover:bg-blue-600 mr-2"
          >{mode === "edit" ? "保存" : "登録"}</button>
          <button
            type="button"
            className="bg-gray-300 text-gray-800 rounded px-4 py-2"
            onClick={onClose}
          >キャンセル</button>
        </div>
      </form>
    </div>
  );
}
