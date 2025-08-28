"use client";

import React, { useState, useEffect } from "react";

// 型定義（省略せずそのまま記載）
type AIGeneratedPersonaModalProps = {
  open: boolean;
  onClose: () => void;
  personaDetail: string;
  personaSimple: string;
  onApply: (payload: AIPersonaPayload) => void;
};
type AccountCopyModalProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (account: any) => void;
};
type SNSAccountModalProps = {
  open: boolean;
  onClose: () => void;
  mode?: "create" | "edit";
  account?: any;
  reloadAccounts: () => void;
};
type AIPersonaPayload = {
  personaDetail: any;
  personaSimple: string;
};
type AccountType = {
  accountId: string;
  displayName: string;
  accessToken?: string;
  characterImage?: string;
  personaMode?: "simple" | "detail";
  personaSimple?: string;
  personaDetail?: string;
  autoPostGroupId?: string;
  createdAt?: number;
  /** ▼追加: 2段階投稿用のThreads投稿本文 */
  secondStageContent?: string; // ← 追加（既存コメントは変更しない）
};
type AutoPostGroupType = {
  groupKey: string;
  groupName: string;
};
type PersonaType = {
  name: string;
  age: string;
  gender: string;
  job: string;
  lifestyle: string;
  character: string;
  tone: string;
  vocab: string;
  emotion: string;
  erotic: string;
  target: string;
  purpose: string;
  distance: string;
  ng: string;
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
      <div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded shadow-lg w-full max-w-xl p-6">
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
  const [accounts, setAccounts] = useState<AccountType[]>([]);
  const [selected, setSelected] = useState<AccountType | null>(null);

  useEffect(() => {
    if (open) {
      fetch(`/api/threads-accounts`, { credentials: "include" })
        .then((res) => res.json())
        .then((data) => setAccounts((data.accounts ?? data.items ?? []) as AccountType[])); // [FIX] {items} 形式も許容
      setSelected(null);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
      <div className="bg-white rounded shadow-lg w-full max-w-xl p-6">
        <h3 className="font-bold text-lg mb-3">複製するアカウントを選択</h3>
        <div className="max-h-60 overflow-y-auto mb-2 border rounded">
          {accounts.map((acc: AccountType) => (
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
          {accounts.length === 0 && (
            <div className="text-center p-4 text-gray-400">アカウントがありません</div>
          )}
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
                    if (typeof detail === "string") {
                      if (detail.trim() === "" || detail.trim() === "{}") return "（簡易ペルソナ入力のみ）";
                      detail = JSON.parse(detail);
                    }
                    if (typeof detail === "object" && Object.keys(detail).length === 0) {
                      return "（簡易ペルソナ入力のみ）";
                    }
                    return JSON.stringify(detail, null, 2);
                  } catch {
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

  const [displayName, setDisplayName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [characterImage, setCharacterImage] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [groupId, setGroupId] = useState("");
  const [groups, setGroups] = useState<AutoPostGroupType[]>([]);
  const [persona, setPersona] = useState<PersonaType>(emptyPersona);
  const [personaMode, setPersonaMode] = useState("detail");
  const [personaSimple, setPersonaSimple] = useState("");
  /** ▼追加: 2段階投稿テキスト */
  const [secondStageContent, setSecondStageContent] = useState(""); // ← 追加
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [aiPreviewModalOpen, setAiPreviewModalOpen] = useState(false);
  const [aiPersonaDetail, setAiPersonaDetail] = useState("");
  const [aiPersonaSimple, setAiPersonaSimple] = useState("");

  // グループ一覧の取得
  useEffect(() => {
    if (!open) return;
    fetch(`/api/auto-post-groups`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setGroups(data.groups ?? []));
  }, [open]);

  useEffect(() => {
    if (mode === "edit" && account) {
      setDisplayName(account.displayName || "");
      setAccountId(account.accountId || "");
      setAccessToken(account.accessToken || "");
      setGroupId(account.autoPostGroupId || "");
      // ▼【追加】不正なJSON文字列で落ちないようガード
      try {
        setPersona(account.personaDetail ? JSON.parse(account.personaDetail) : { ...emptyPersona }); // 【追加】
      } catch {
        setPersona({ ...emptyPersona }); // 【追加】
      }
      setCharacterImage(account.characterImage || "");
      setPersonaMode(account.personaMode === "simple" ? "simple" : "detail");
      setPersonaSimple(account.personaSimple || "");
      setSecondStageContent(account.secondStageContent || ""); // ← 追加
    } else if (mode === "create") {
      setDisplayName("");
      setAccountId("");
      setAccessToken("");
      setGroupId("");
      setPersonaMode("detail");
      setPersonaSimple("");
      setPersona({ ...emptyPersona });
      setCharacterImage("");
      setSecondStageContent(""); // ← 追加
    }
    setError("");
  }, [account, mode]);

  const handlePersonaChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setPersona({ ...persona, [e.target.name]: e.target.value });

  const handleCopyAccountData = (acc: any) => {
    setDisplayName("");
    setAccountId("");
    setAccessToken("");
    setGroupId("");
    setCharacterImage(acc.characterImage || "");
    setPersonaMode(acc.personaMode || "detail");
    setPersonaSimple(acc.personaSimple || "");
    // ▼【追加】コピー元のJSONもガード
    try {
      setPersona(acc.personaDetail ? JSON.parse(acc.personaDetail) : { ...emptyPersona }); // 【追加】
    } catch {
      setPersona({ ...emptyPersona }); // 【追加】
    }
    setSecondStageContent(acc.secondStageContent || ""); // ← 追加
    setCopyModalOpen(false);
  };

  const handleAIGenerate = async () => {
    setAiLoading(true);
    setError("");
    setAiPersonaDetail("");
    setAiPersonaSimple("");
    try {
      // ▼【追加】空入力の早期バリデーション
      if (!characterImage.trim()) {
        setAiLoading(false);
        setError("キャラクターイメージを入力してください。"); // 【追加】
        return;
      }

      const res = await fetch("/api/ai-gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          purpose: "persona-generate",
          input: { personaSeed: characterImage || "" },
        }),
      });

      // ▼【追加】非200時の詳細メッセージを拾う
      const data = await res.json().catch(() => ({} as any)); // 【追加】
      setAiLoading(false);

      if (!res.ok) {
        const msg = (data as any)?.error || (data as any)?.message || "AI生成に失敗しました"; // 【追加】
        setError(msg); // 【追加】
        return;
      }

      if ((data as any).error) {
        setError((data as any).error);
        return;
      }

      setAiPersonaDetail((data as any).personaDetail || "");
      setAiPersonaSimple((data as any).personaSimple || "");
      setAiPreviewModalOpen(true);
    } catch (e: unknown) {
      setError("AI生成エラー: " + String(e));
      setAiLoading(false);
    }
  };

  const handleApplyAIPersona = ({ personaDetail, personaSimple }: AIPersonaPayload) => {
    // ▼【追加】文字列JSONのまま渡ってきても安全に取り込む
    try {
      const obj =
        typeof personaDetail === "string" && personaDetail.trim()
          ? JSON.parse(personaDetail)
          : personaDetail || {};
      setPersona({ ...emptyPersona, ...(obj || {}) });
    } catch {
      setPersona({ ...emptyPersona });
    }
    setPersonaSimple(personaSimple || "");
    setAiPreviewModalOpen(false);
  };

  const originalAccountId = account?.accountId;

  // [ADD] 削除ハンドラ（編集時のみ使用）
  const handleDelete = async () => {
    if (!originalAccountId) return;
    if (!confirm("このアカウントを削除します。よろしいですか？")) return;
    try {
      const res = await fetch("/api/threads-accounts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accountId: originalAccountId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) throw new Error(data?.error || "delete failed");
      await reloadAccounts();
      onClose();
    } catch (e: any) {
      alert("削除に失敗しました: " + (e?.message || e));
    }
  };

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
      // 編集時にIDが変わった場合は旧データを削除
      if (mode === "edit" && originalAccountId && originalAccountId !== accountId) {
        await fetch("/api/threads-accounts", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ accountId: originalAccountId }),
        });
      }
      const method = mode === "create" ? "POST" : "PUT";
      const res = await fetch("/api/threads-accounts", {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          accountId,
          displayName,
          accessToken: accessToken,
          createdAt:
            mode === "create"
              ? Math.floor(Date.now() / 1000)
              : account?.createdAt ?? Math.floor(Date.now() / 1000),
          personaDetail: JSON.stringify(persona),
          personaSimple: personaSimple,
          personaMode: personaMode,
          autoPostGroupId: groupId,
          characterImage: characterImage || "",
          /** ▼追加送信: 2段階投稿テキスト */
          secondStageContent: secondStageContent || "", // ← 追加
        }),
      });
      // [FIX] 成否判定を res.ok / data.ok で行う（APIは {ok:true} を返す）
      let data: any = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }
      setSaving(false);
      if (res.ok || data.ok) { // [FIX]
        if (reloadAccounts) reloadAccounts();
        onClose();
      } else {
        setError(data.error || "保存に失敗しました"); // [FIX]
      }
    } catch (e: unknown) {
      setError("通信エラー: " + String(e));
      setSaving(false);
    }
  };

  

  if (!open) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
      <AccountCopyModal
        open={copyModalOpen}
        onClose={() => setCopyModalOpen(false)}
        onSelect={handleCopyAccountData}
      />
      <AIGeneratedPersonaModal
        open={aiPreviewModalOpen}
        onClose={() => setAiPreviewModalOpen(false)}
        personaDetail={aiPersonaDetail}
        personaSimple={aiPersonaSimple}
        onApply={handleApplyAIPersona}
      />
      <form
        className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-8 rounded shadow-lg min-w-[600px] max-h-[90vh] overflow-y-auto relative"
        onSubmit={handleSubmit}
      >
        <button type="button" className="absolute top-2 right-2 text-gray-400" onClick={onClose}>
          ×
        </button>
        <h2 className="text-xl font-bold mb-4">
          {mode === "edit" ? "アカウント編集" : "新規アカウント追加"}
        </h2>

        {error && <div className="mb-3 text-red-500">{error}</div>}

        {/* ここから上の既存項目は “全部そのまま” 残しています */}
        <label className="block">アカウント名</label>
        <input
          className="mb-2 border rounded px-2 py-1 w-full"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="例）営業用公式アカウント"
        />

        <label className="block">ID</label>
        <input
          className="mb-2 border rounded px-2 py-1 w-full"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          placeholder="@account_id"
        />

        <label className="block">アクセストークン</label>
        <input
          className="mb-2 border rounded px-2 py-1 w-full"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
        />

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

        <div className="my-3 flex gap-2">
          <button
            type="button"
            className="border px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100 border-gray-300 dark:border-gray-700"
            onClick={() => setCopyModalOpen(true)}
          >
            既存アカウント複製
          </button>
        </div>

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

        {personaMode === "simple" ? (
          <textarea
            className="border rounded p-2 w-full mb-3 min-h-[80px] resize-y"
            placeholder="簡易ペルソナ（例：このアカウントは〇〇な性格で、〇〇が好きな女性...）"
            value={personaSimple}
            onChange={(e) => setPersonaSimple(e.target.value)}
          />
        ) : (
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 mb-3">
            <input
              className="border px-2 py-1 rounded"
              name="name"
              value={persona.name}
              onChange={handlePersonaChange}
              placeholder="名前"
            />
            <input
              className="border px-2 py-1 rounded"
              name="age"
              value={persona.age}
              onChange={handlePersonaChange}
              placeholder="年齢"
            />
            <input
              className="border px-2 py-1 rounded"
              name="gender"
              value={persona.gender}
              onChange={handlePersonaChange}
              placeholder="性別"
            />
            <input
              className="border px-2 py-1 rounded"
              name="job"
              value={persona.job}
              onChange={handlePersonaChange}
              placeholder="職業"
            />
            <input
              className="border px-2 py-1 rounded"
              name="lifestyle"
              value={persona.lifestyle}
              onChange={handlePersonaChange}
              placeholder="生活スタイル"
            />
            <input
              className="border px-2 py-1 rounded"
              name="character"
              value={persona.character}
              onChange={handlePersonaChange}
              placeholder="投稿キャラ"
            />
            <input
              className="border px-2 py-1 rounded"
              name="tone"
              value={persona.tone}
              onChange={handlePersonaChange}
              placeholder="口調・内面"
            />
            <input
              className="border px-2 py-1 rounded"
              name="vocab"
              value={persona.vocab}
              onChange={handlePersonaChange}
              placeholder="語彙傾向"
            />
            <input
              className="border px-2 py-1 rounded"
              name="emotion"
              value={persona.emotion}
              onChange={handlePersonaChange}
              placeholder="感情パターン"
            />
            <input
              className="border px-2 py-1 rounded"
              name="erotic"
              value={persona.erotic}
              onChange={handlePersonaChange}
              placeholder="エロ表現"
            />
            <input
              className="border px-2 py-1 rounded"
              name="target"
              value={persona.target}
              onChange={handlePersonaChange}
              placeholder="ターゲット層"
            />
            <input
              className="border px-2 py-1 rounded"
              name="purpose"
              value={persona.purpose}
              onChange={handlePersonaChange}
              placeholder="投稿目的"
            />
            <input
              className="border px-2 py-1 rounded"
              name="distance"
              value={persona.distance}
              onChange={handlePersonaChange}
              placeholder="絡みの距離感"
            />
            <input
              className="border px-2 py-1 rounded"
              name="ng"
              value={persona.ng}
              onChange={handlePersonaChange}
              placeholder="NG要素"
            />
          </div>
        )}

        <label className="block">投稿グループ</label>
        <select
          className="mb-4 border px-2 py-1 rounded w-full"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
        >
          <option value="">選択してください</option>
          {groups.map((g: AutoPostGroupType) => (
            <option key={g.groupKey} value={g.groupKey}>
              {g.groupName}
            </option>
          ))}
        </select>

        {/* ▼追加UI: 2段階投稿（Threads用テキスト） */}
        <label className="block font-semibold mt-4">2段階投稿（Threads用テキスト）</label>
        <textarea
          className="border rounded p-2 w-full mb-4 min-h-[80px] resize-y"
          placeholder="例: 1回目投稿の◯分後にThreadsへ投稿する文章"
          value={secondStageContent}
          onChange={(e) => setSecondStageContent(e.target.value)}
        />

        <div className="mt-6 flex items-center justify-between">
          <div>
            {mode === "edit" && (
              <button
                type="button"
                onClick={handleDelete}
                className="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700"
              >
                削除
              </button>
            )}
          </div>
          <div className="text-right">
            <button
              type="submit"
              className="bg-blue-500 text-white rounded px-5 py-2 hover:bg-blue-600 mr-2"
              // 既存の saving フラグがある場合は disabled を付与
            >
              {mode === "edit" ? "保存" : "登録"}
            </button>
            <button
              type="button"
              className="bg-gray-300 text-gray-800 rounded px-4 py-2"
              onClick={onClose}
            >
              キャンセル
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
