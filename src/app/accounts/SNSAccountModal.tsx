"use client";

import React, { useState, useEffect } from "react";
import AIGeneratedPersonaModal from "./AIGeneratedPersonaModal";
import AccountCopyModal from "./AccountCopyModal";

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

// AIGeneratedPersonaModal is extracted to its own file to avoid large TSX parsing issues

// AccountCopyModal implementation moved to `src/app/accounts/AccountCopyModal.tsx` (local duplicate removed)

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
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
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
  const [bulkPersonaOpen, setBulkPersonaOpen] = useState(false);
  const [bulkPersonaText, setBulkPersonaText] = useState("");

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
      setClientId(account.clientId || "");
      setClientSecret(account.clientSecret || "");
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
      setClientId("");
      setClientSecret("");
      setGroupId("");
      setPersonaMode("detail");
      setPersonaSimple("");
      setPersona({ ...emptyPersona });
      setCharacterImage("");
      setSecondStageContent(""); // ← 追加
    }
    setError("");
  }, [account, mode]);

  const handlePersonaChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setPersona({ ...persona, [e.target.name]: e.target.value });

  const handleCopyAccountData = (acc: any) => {
    setDisplayName("");
    setAccountId("");
    setAccessToken("");
    setClientId(acc.clientId || "");
    setClientSecret(acc.clientSecret || "");
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

  // ペルソナ一括貼付の処理を外だしして JSX 内の複雑な表現を避ける
  const applyBulkPersona = () => {
    const mapping: Record<string, keyof PersonaType> = {
      名前: "name",
      年齢: "age",
      性別: "gender",
      職業: "job",
      生活スタイル: "lifestyle",
      投稿キャラ: "character",
      "口調・内面": "tone",
      語彙傾向: "vocab",
      "感情パターン": "emotion",
      エロ表現: "erotic",
      ターゲット層: "target",
      投稿目的: "purpose",
      "絡みの距離感": "distance",
      NG要素: "ng",
    };
    const lines = String(bulkPersonaText || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const newPersona = { ...persona } as any;
    for (const line of lines) {
      const parts = line.split(/\t|\s*:\s*|\s+/, 2).map(p => p.trim());
      if (parts.length < 2) continue;
      const key = parts[0];
      const val = parts[1];
      const field = mapping[key];
      if (field) newPersona[field] = val;
    }
    setPersona(newPersona);
    setBulkPersonaOpen(false);
    setBulkPersonaText("");
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
      // 新規作成時: 同一 accountId の存在チェック
      if (mode === "create") {
        try {
          const checkRes = await fetch(`/api/threads-accounts`, { credentials: "include" });
          if (checkRes.ok) {
            const checkData = await checkRes.json();
            const existing = (checkData.items || checkData.accounts || []).find((a: any) => String(a.accountId || a.username || "") === String(accountId));
            if (existing) {
              setError("既に登録されたアカウントです");
              setSaving(false);
              return;
            }
          }
        } catch (e) {
          // チェック失敗は無視して続行（APIエラーがある場合は後続のConditionExpressionで弾かれる）
          console.log("dup-check failed:", e);
        }
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
          clientId: clientId || undefined,
          clientSecret: clientSecret || undefined,
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

  

  if (!open) { return null; }

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
      <div className="relative min-w-[520px] max-h-[90vh] w-full max-w-[80vw]">
        <button
          type="button"
          className="absolute top-2 right-2 text-gray-400 text-2xl p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 z-20"
          onClick={onClose}
          aria-label="閉じる"
        >
          ×
        </button>
        <form
          className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-8 rounded shadow-lg min-w-[520px] max-h-[90vh] overflow-y-auto"
          onSubmit={handleSubmit}
        >
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

        {/* 認可ボタン（編集時のみ表示） */}
        {mode === "edit" && accountId && (
          <div className="mb-3">
            <button
              type="button"
              className="bg-yellow-500 text-white rounded px-3 py-1 hover:bg-yellow-600"
              onClick={() => {
                const url = '/api/auth/threads/start' + (accountId ? `?accountId=${encodeURIComponent(accountId)}` : '');
                window.open(url, '_blank');
              }}
            >
              認可を再実行
            </button>
          </div>
        )}

        <label className="block mt-2">Threads App ID (clientId)</label>
        <input
          className="mb-2 border rounded px-2 py-1 w-full"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        />

        <label className="block">Threads App Secret (clientSecret)</label>
        <input
          className="mb-2 border rounded px-2 py-1 w-full"
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
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

        {/* 既存アカウント複製ボタン：ラベルを明示、キャンセルは右上×のみで統一 */}
        <div className="my-3 flex gap-2">
          <button
            type="button"
            className="border px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100 border-gray-300 dark:border-gray-700"
            onClick={() => setCopyModalOpen(true)}
            aria-label="既存アカウント複製"
          >
            既存アカウント複製
          </button>
        </div>

        {/* ペルソナ入力（詳細モードをベースに、職業以下は大きめtextareaでタイトル付与） */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold">ペルソナ入力</span>
            <label className="flex items-center gap-1 cursor-pointer text-sm">
              <input
                type="checkbox"
                className="form-checkbox"
                checked={personaMode === "simple"}
                onChange={() => setPersonaMode(personaMode === "simple" ? "detail" : "simple")}
              />
              <span>簡易ペルソナ入力に切替</span>
            </label>
          </div>

          <div className="flex items-center gap-2 mb-2">
            <div className="flex-1" />
            <button
              type="button"
              className="text-sm px-2 py-1 border rounded bg-gray-50 hover:bg-gray-100"
              onClick={() => setBulkPersonaOpen((s) => !s)}
            >
              ペルソナ一括貼付
            </button>
          </div>

          {bulkPersonaOpen && (
            <div className="mb-3">
              <label className="block text-sm text-gray-600">貼付用テキスト</label>
              <textarea
                className="w-full border rounded p-2 mb-2 min-h-[120px]"
                value={bulkPersonaText}
                onChange={(e) => setBulkPersonaText(e.target.value)}
                placeholder={"例:\n名前\tゆうか\n年齢\t27\n..."}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="bg-blue-500 text-white px-3 py-1 rounded dark:bg-blue-600 dark:hover:bg-blue-700"
                  onClick={applyBulkPersona}
                >貼付して反映</button>
                <button
                  type="button"
                  className="px-3 py-1 border rounded dark:bg-gray-800 dark:text-gray-100"
                  onClick={() => { setBulkPersonaText(""); setBulkPersonaOpen(false); }}
                >キャンセル</button>
              </div>
            </div>
          )}

          {personaMode === "simple" ? (
            <textarea
              className="border rounded p-2 w-full mb-3 min-h-[80px] resize-y dark:bg-gray-800 dark:text-gray-100"
              placeholder="簡易ペルソナ（例：このアカウントは〇〇な性格で、〇〇が好きな女性...）"
              value={personaSimple}
              onChange={(e) => setPersonaSimple(e.target.value)}
            />
          ) : (
            <div className="grid grid-cols-2 gap-x-3 gap-y-4 mb-3">
              <div>
                <label className="text-sm text-gray-600">名前</label>
                <input className="border px-2 py-1 rounded w-full dark:bg-gray-800 dark:text-gray-100" name="name" value={persona.name} onChange={handlePersonaChange} placeholder="名前" />
              </div>
              <div>
                <label className="text-sm text-gray-600">年齢</label>
                <input className="border px-2 py-1 rounded w-full dark:bg-gray-800 dark:text-gray-100" name="age" value={persona.age} onChange={handlePersonaChange} placeholder="年齢" />
              </div>

              <div>
                <label className="text-sm text-gray-600">性別</label>
                <input className="border px-2 py-1 rounded w-full dark:bg-gray-800 dark:text-gray-100" name="gender" value={persona.gender} onChange={handlePersonaChange} placeholder="性別" />
              </div>
              <div className="col-span-2">
                <label className="text-sm text-gray-600">職業</label>
                <textarea className="border rounded p-2 w-full dark:bg-gray-800 dark:text-gray-100" name="job" value={persona.job} onChange={handlePersonaChange} />
              </div>

              {/* 職業以下は大きめtextarea群（タイトル付き） */}
              <div className="col-span-2 grid grid-cols-1 gap-3">
                <div>
                  <label className="text-sm text-gray-600">生活スタイル</label>
                  <textarea className="border rounded p-2 w-full dark:bg-gray-800 dark:text-gray-100" name="lifestyle" value={persona.lifestyle} onChange={handlePersonaChange} />
                </div>
                <div>
                  <label className="text-sm text-gray-600">投稿キャラ</label>
                  <textarea className="border rounded p-2 w-full dark:bg-gray-800 dark:text-gray-100" name="character" value={persona.character} onChange={handlePersonaChange} />
                </div>
                <div>
                  <label className="text-sm text-gray-600">口調・内面</label>
                  <textarea className="border rounded p-2 w-full dark:bg-gray-800 dark:text-gray-100" name="tone" value={persona.tone} onChange={handlePersonaChange} />
                </div>
                <div>
                  <label className="text-sm text-gray-600">語彙傾向</label>
                  <textarea className="border rounded p-2 w-full dark:bg-gray-800 dark:text-gray-100" name="vocab" value={persona.vocab} onChange={handlePersonaChange} />
                </div>
                <div>
                  <label className="text-sm text-gray-600">感情パターン</label>
                  <textarea className="border rounded p-2 w-full dark:bg-gray-800 dark:text-gray-100" name="emotion" value={persona.emotion} onChange={handlePersonaChange} />
                </div>
                <div>
                  <label className="text-sm text-gray-600">エロ表現</label>
                  <textarea className="border rounded p-2 w-full dark:bg-gray-800 dark:text-gray-100" name="erotic" value={persona.erotic} onChange={handlePersonaChange} />
                </div>
                <div>
                  <label className="text-sm text-gray-600">ターゲット層</label>
                  <textarea className="border rounded p-2 w-full dark:bg-gray-800 dark:text-gray-100" name="target" value={persona.target} onChange={handlePersonaChange} />
                </div>
                <div>
                  <label className="text-sm text-gray-600">投稿目的</label>
                  <textarea className="border rounded p-2 w-full dark:bg-gray-800 dark:text-gray-100" name="purpose" value={persona.purpose} onChange={handlePersonaChange} />
                </div>
                <div>
                  <label className="text-sm text-gray-600">絡みの距離感</label>
                  <textarea className="border rounded p-2 w-full dark:bg-gray-800 dark:text-gray-100" name="distance" value={persona.distance} onChange={handlePersonaChange} />
                </div>
                <div>
                  <label className="text-sm text-gray-600">NG要素</label>
                  <textarea className="border rounded p-2 w-full dark:bg-gray-800 dark:text-gray-100" name="ng" value={persona.ng} onChange={handlePersonaChange} />
                </div>
              </div>
            </div>
          )}
        </div>

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
            {/* Cancel removed - use top-right × to close */}
          </div>
        </div>
      </form>
    </div>
  </div>
  );
}
