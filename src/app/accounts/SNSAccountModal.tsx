"use client";

import React, { useState, useEffect } from "react";

// 型定義
// --- AI生成プレビュー用モーダル ---
type AIGeneratedPersonaModalProps = {
  open: boolean;
  onClose: () => void;
  personaDetail: string;
  personaSimple: string;
  onApply: (payload: AIPersonaPayload) => void;
};
// --- 既存アカウント複製用モーダル ---
type AccountCopyModalProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (account: any) => void; // account型があれば型指定推奨
};
// --- SNSアカウントモーダルのプロパティ型 ---
type SNSAccountModalProps = {
  open: boolean;
  onClose: () => void;
  mode?: "create" | "edit"; // デフォルト値が"create"の場合（必要に応じて修正）
  account?: any; // account型がわかれば具体的に
  reloadAccounts: () => void;
};
// --- AIペルソナ生成のペイロード型 ---
type AIPersonaPayload = {
  personaDetail: any; // 詳細な型がわからなければ any で仮対応
  personaSimple: string;
};

function AIGeneratedPersonaModal({
  open,
  onClose,
  personaDetail,
  personaSimple,
  onApply,
}: AIGeneratedPersonaModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
      <div className="bg-white rounded shadow-lg w-full max-w-xl p-6">
        <h3 className="font-bold text-lg mb-3">AI生成ペルソナ内容を確認</h3>
        <div className="border rounded bg-gray-50 p-3 my-2">
          <div className="text-sm text-gray-700 mb-1">簡易ペルソナ</div>
          <div className="text-xs whitespace-pre-wrap break-all bg-white p-2 rounded mb-2">
            {personaSimple || <span className="text-gray-400">（未生成）</span>}
          </div>
          <div className="text-sm text-gray-700 mb-1">詳細ペルソナ</div>
          <pre className="text-xs whitespace-pre-wrap break-all bg-white p-2 rounded">
            {typeof personaDetail === "string"
              ? personaDetail
              : JSON.stringify(personaDetail, null, 2)}
          </pre>
        </div>
        <div className="flex justify-end mt-3 gap-2">
          <button
            className="bg-gray-300 text-gray-800 px-4 py-2 rounded"
            onClick={onClose}
          >
            キャンセル
          </button>
          <button
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
            onClick={() => onApply({ personaDetail, personaSimple })}
            disabled={!personaSimple && !personaDetail}
          >
            この内容でセット
          </button>
        </div>
      </div>
    </div>
  );
}

function AccountCopyModal({
  open,
  onClose,
  onSelect,
}: AccountCopyModalProps) {
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (open) {
      const userId = localStorage.getItem("userId");
      fetch(`/api/threads-accounts?userId=${userId}`)
        .then(res => res.json())
        .then(data => setAccounts(data.accounts ?? []));
      setSelected(null);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
      <div className="bg-white rounded shadow-lg w-full max-w-xl p-6">
        <h3 className="font-bold text-lg mb-3">複製するアカウントを選択</h3>
        <div className="max-h-60 overflow-y-auto mb-2 border rounded">
          {accounts.map(acc => (
            <div
              key={acc.accountId}
              className={`p-2 cursor-pointer border-b last:border-b-0 hover:bg-blue-50 ${
                selected?.accountId === acc.accountId ? "bg-blue-100" : ""
              }`}
              onClick={() => setSelected(acc)}
            >
              <div className="font-semibold">{acc.displayName}</div>
              <div className="text-xs text-gray-600">{acc.accountId}</div>
            </div>
          ))}
          {accounts.length === 0 && <div className="text-center p-4 text-gray-400">アカウントがありません</div>}
        </div>
        {selected && (
          <div className="border rounded bg-gray-50 p-3 my-2">
            <div className="text-sm text-gray-700 mb-1">簡易ペルソナ</div>
            <div className="text-xs whitespace-pre-wrap break-all bg-white p-2 rounded mb-2">
              {selected.personaSimple || <span className="text-gray-400">（未入力）</span>}
            </div>
            <div className="text-sm text-gray-700 mb-1">詳細ペルソナ</div>
            <pre className="text-xs whitespace-pre-wrap break-all bg-white p-2 rounded">
              {
                (() => {
                  let detail = selected.personaDetail;
                  if (!detail) return "（簡易ペルソナ入力のみ）";
                  try {
                    // 文字列ならJSON.parseして整形
                    if (typeof detail === "string") {
                      if (detail.trim() === "" || detail.trim() === "{}") return "（簡易ペルソナ入力のみ）";
                      detail = JSON.parse(detail);
                    }
                    // オブジェクトかつ空オブジェクトも検出
                    if (typeof detail === "object" && Object.keys(detail).length === 0) {
                      return "（簡易ペルソナ入力のみ）";
                    }
                    // 日本語キーや英語キーが混在していてもよい
                    return JSON.stringify(detail, null, 2);
                  } catch {
                    // パースできない場合はそのまま表示
                    return detail || "（簡易ペルソナ入力のみ）";
                  }
                })()
              }
            </pre>
          </div>
        )}
        <div className="flex justify-end mt-3 gap-2">
          <button
            className="bg-gray-300 text-gray-800 px-4 py-2 rounded"
            onClick={onClose}
          >
            キャンセル
          </button>
          <button
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
            onClick={() => {
              if (selected) onSelect(selected);
            }}
            disabled={!selected}
          >
            この内容で複製
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SNSAccountModal({
  open,
  onClose,
  mode = "create",
  account,
  reloadAccounts,
}: SNSAccountModalProps) {
  // 入力state
  const [displayName, setDisplayName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [characterImage, setCharacterImage] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [groupId, setGroupId] = useState("");
  const [groups, setGroups] = useState([]);
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
  const [personaMode, setPersonaMode] = useState("detail");
  const [personaSimple, setPersonaSimple] = useState("");

  // エラー表示・保存中管理
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // モーダル管理
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [aiPreviewModalOpen, setAiPreviewModalOpen] = useState(false);
  const [aiPersonaDetail, setAiPersonaDetail] = useState("");
  const [aiPersonaSimple, setAiPersonaSimple] = useState("");
  // 期待する内部キー
  const emptyPersona = {
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
  };

  // グループ一覧の取得
  useEffect(() => {
    if (!open) return;
    const userId = localStorage.getItem("userId");
    fetch(`/api/auto-post-groups?userId=${userId}`)
      .then(res => res.json())
      .then(data => setGroups(data.groups ?? []));
  }, [open]);

  // 編集時は初期値セット
  useEffect(() => {
    if (mode === "edit" && account) {
      setDisplayName(account.displayName || "");
      setAccountId(account.accountId || "");
      setAccessToken(account.accessToken || "");
      setGroupId(account.autoPostGroupId || "");
      setPersona(account.personaDetail ? JSON.parse(account.personaDetail) : {});
      setCharacterImage(account.characterImage || "");
      setPersonaMode(account.personaMode === "simple" ? "simple" : "detail");
      setPersonaSimple(account.personaSimple || "");
    } else if (mode === "create") {
      setDisplayName("");
      setAccountId("");
      setAccessToken("");
      setGroupId("");
      setPersonaMode("detail");
      setPersonaSimple("");
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
    setError("");
  }, [account, mode]);

  // ペルソナ入力
  const handlePersonaChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setPersona({ ...persona, [e.target.name]: e.target.value });

  // 複製データ反映
  const handleCopyAccountData = (acc: any) => {
    setDisplayName("");
    setAccountId("");
    setAccessToken("");
    setGroupId("");
    setCharacterImage(acc.characterImage || "");
    setPersonaMode(acc.personaMode || "detail");
    setPersonaSimple(acc.personaSimple || "");
    setPersona(acc.personaDetail ? JSON.parse(acc.personaDetail) : {});
    setCopyModalOpen(false);
  };

  // AIペルソナ生成＆プレビュー
  const handleAIGenerate = async () => {
    setAiLoading(true);
    setError("");
    setAiPersonaDetail("");
    setAiPersonaSimple("");
    try {
      const userId = localStorage.getItem("userId");
      const res = await fetch("/api/ai-gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          purpose: "persona-generate",
          input: { personaSeed: characterImage || "" }, // キャラクターイメージだけを送信
        }),
      });
      const data = await res.json();
      setAiLoading(false);

      if (data.error) {
        setError(data.error);
        return;
      }

      setAiPersonaDetail(data.personaDetail || "");
      setAiPersonaSimple(data.personaSimple || "");
      setAiPreviewModalOpen(true);
    } catch (e: unknown) {
      setError("AI生成エラー: " + String(e));
      setAiLoading(false);
    }
  };

  // AIで返ってきたJSONをセットする部分
  const handleApplyAIPersona = ({ personaDetail, personaSimple }: AIPersonaPayload) => {
    setPersona({ ...emptyPersona, ...personaDetail });
    setPersonaSimple(personaSimple || "");
    setAiPreviewModalOpen(false);
  };
  
  // 編集時の元のIDを保持
  const originalAccountId = account?.accountId;

  // 登録・保存（DB/API連携）
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    if (!displayName || !accountId) {
      setError("アカウント名・IDは必須です");
      setSaving(false);
      return;
    }
    try {
      const userId = localStorage.getItem("userId");
      if (mode === "edit" && originalAccountId && originalAccountId !== accountId) {
        await fetch("/api/threads-accounts", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, accountId: originalAccountId }),
        });
      }
      const method = mode === "create" ? "POST" : "PUT";
      const res = await fetch("/api/threads-accounts", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          accountId,
          displayName,
          accessToken: accessToken,
          createdAt: mode === "create"
            ? Math.floor(Date.now() / 1000)
            : account?.createdAt ?? Math.floor(Date.now() / 1000),
          personaDetail: JSON.stringify(persona),
          personaSimple: personaSimple,
          personaMode: personaMode,
          autoPostGroupId: groupId,
          characterImage: characterImage || "",
        }),
      });
      const data = await res.json();
      setSaving(false);
      if (data.success) {
        if (reloadAccounts) reloadAccounts();
        onClose();
      } else {
        setError(data.error || "保存に失敗しました");
      }
    } catch (e: unknown) {
      setError("通信エラー: " + String(e));
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
      {/* 既存アカウント複製モーダル */}
      <AccountCopyModal
        open={copyModalOpen}
        onClose={() => setCopyModalOpen(false)}
        onSelect={handleCopyAccountData}
      />

      {/* AI生成プレビュー・確認モーダル */}
      <AIGeneratedPersonaModal
        open={aiPreviewModalOpen}
        onClose={() => setAiPreviewModalOpen(false)}
        personaDetail={aiPersonaDetail}
        personaSimple={aiPersonaSimple}
        onApply={handleApplyAIPersona}
      />

      <form
        className="bg-white p-8 rounded shadow-lg min-w-[600px] max-h-[90vh] overflow-y-auto relative"
        onSubmit={handleSubmit}
      >
        <button type="button" className="absolute top-2 right-2 text-gray-400" onClick={onClose}>×</button>
        <h2 className="text-xl font-bold mb-4">{mode === "edit" ? "アカウント編集" : "新規アカウント追加"}</h2>

        {/* エラー表示 */}
        {error && <div className="mb-3 text-red-500">{error}</div>}

        {/* アカウント名 */}
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
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCharacterImage(e.target.value)}
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

        {/* 既存アカウント複製 */}
        <div className="my-3 flex gap-2">
          <button
            type="button"
            className="border px-2 py-1 rounded bg-gray-100"
            onClick={() => setCopyModalOpen(true)}
          >
            既存アカウント複製
          </button>
        </div>

        {/* 簡易ペルソナ切り替え */}
        <div className="mb-2 flex items-center gap-4">
          <span className="font-semibold">ペルソナ入力</span>
          <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={personaMode === "simple"}
            onChange={() => setPersonaMode(personaMode === "simple" ? "detail" : "simple")}
          />
            <span className="text-sm">簡易ペルソナ入力に切替</span>
          </label>
        </div>

        {/* ペルソナ詳細 or 簡易ペルソナ */}
        {personaMode === "simple" ? (
          <textarea
            className="border rounded p-2 w-full mb-3 min-h-[80px] resize-y"
            placeholder="簡易ペルソナ（例：このアカウントは〇〇な性格で、〇〇が好きな女性...）"
            value={personaSimple}
            onChange={e => setPersonaSimple(e.target.value)}
          />
        ) : (
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
        )}

        {/* 自動投稿グループ */}
        <label className="block">自動投稿グループ</label>
        <select
          className="mb-4 border px-2 py-1 rounded w-full"
          value={groupId}
          onChange={e => setGroupId(e.target.value)}
        >
          <option value="">選択してください</option>
          {groups.map(g => (
            <option key={g.groupKey} value={g.groupKey}>
              {g.groupName}
            </option>
          ))}
        </select>

        <div className="text-right mt-6">
          <button
            type="submit"
            className="bg-blue-500 text-white rounded px-5 py-2 hover:bg-blue-600 mr-2"
            disabled={saving}
          >{mode === "edit" ? "保存" : "登録"}</button>
          <button
            type="button"
            className="bg-gray-300 text-gray-800 rounded px-4 py-2"
            onClick={onClose}
            disabled={saving}
          >キャンセル</button>
        </div>
      </form>
    </div>
  );
}
