// src/ui-components/SNSAccountModal.jsx
import React, { useState, useEffect } from "react";

// ダミー：グループ選択肢
const dummyGroups = [
  { id: "g1", name: "朝投稿グループ" },
  { id: "g2", name: "夜投稿グループ" },
];

export default function SNSAccountModal({ open, onClose, mode = "create", account }) {
  // 新規追加：アカウント名
  const [displayName, setDisplayName] = useState("");

  const [accountId, setAccountId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [characterImage, setCharacterImage] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

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
      setDisplayName(account.displayName || "");
      setAccountId(account.accountId || "");
      setAccessToken(account.accessToken || "");
      setGroupId(account.groupId || "");
      setPersona(account.persona || {});
      setCharacterImage(account.characterImage || "");
    } else if (mode === "create") {
      setDisplayName("");
      setAccountId("");
      setAccessToken("");
      setGroupId("");
      setPersona({
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
      setCharacterImage("");
    }
  }, [account, mode]);

  // ペルソナ入力
  const handlePersonaChange = e =>
    setPersona({ ...persona, [e.target.name]: e.target.value });

  // 既存アカウント複製
  const handleCopyAccount = () => {
    if (!account) return;
    setDisplayName(account.displayName || "");
    setAccountId(account.accountId || "");
    setAccessToken(account.accessToken || "");
    setGroupId(account.groupId || "");
    setPersona(account.persona || {});
    setCharacterImage(account.characterImage || "");
  };

  // キャラクターイメージAI生成（ダミー実装）
  const handleAIGenerate = async () => {
    setAiLoading(true);
    setTimeout(() => {
      setCharacterImage("元気で明るい女性キャラクター（例）");
      setAiLoading(false);
    }, 1000);
  };

  // 登録・保存ダミー
  const handleSubmit = e => {
    e.preventDefault();
    // ここでdisplayNameも含めて送信されるべき
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

        {/* アカウント名（最上部に追加） */}
        <label className="block">アカウント名</label>
        <input
          className="mb-2 border rounded px-2 py-1 w-full"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          placeholder="例）営業用公式アカウント"
        />

        {/* アカウントID */}
        <label className="block">アカウントID</label>
        <input
          className="mb-2 border rounded px-2 py-1 w-full"
          value={accountId}
          onChange={e => setAccountId(e.target.value)}
          placeholder="@account_id"
        />

        {/* アクセストークン */}
        <label className="block">アクセストークン</label>
        <input
          className="mb-2 border rounded px-2 py-1 w-full"
          value={accessToken}
          onChange={e => setAccessToken(e.target.value)}
        />

        {/* キャラクターイメージ input+AI生成ボタン */}
        <label className="block">キャラクターイメージ</label>
        <div className="flex gap-2 mb-2">
          <input
            className="border rounded px-2 py-1 w-full"
            type="text"
            value={characterImage}
            onChange={(e) => setCharacterImage(e.target.value)}
            placeholder="キャラクターイメージ"
          />
          <button
            type="button"
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-400"
            onClick={handleAIGenerate}
            disabled={aiLoading}
          >
            {aiLoading ? "生成中..." : "AI生成"}
          </button>
        </div>

        {/* 既存アカウント複製ボタン（維持） */}
        <div className="my-3 flex gap-2">
          <button type="button" className="border px-2 py-1 rounded bg-gray-100" onClick={handleCopyAccount}>
            既存アカウント複製
          </button>
        </div>

        {/* ペルソナ詳細（完全維持） */}
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

        {/* 自動投稿グループ（維持） */}
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
