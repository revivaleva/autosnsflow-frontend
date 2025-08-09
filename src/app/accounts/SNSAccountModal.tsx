// src/app/accounts/SNSAccountModal.tsx

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
  secondStageContent?: string;
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

// …（AIGeneratedPersonaModal, AccountCopyModal は変更なし）…

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
  const [secondStageContent, setSecondStageContent] = useState("");
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
      .then(res => res.json())
      .then(data => setGroups(data.groups ?? []));
  }, [open]);

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
      setSecondStageContent(account.secondStageContent || ""); // ▼追加
    } else if (mode === "create") {
      setDisplayName("");
      setAccountId("");
      setAccessToken("");
      setGroupId("");
      setPersonaMode("detail");
      setPersonaSimple("");
      setPersona({ ...emptyPersona });
      setCharacterImage("");
      setSecondStageContent(""); // ▼追加
    }
    setError("");
  }, [account, mode]);

  // …（handlePersonaChange, handleCopyAccountData, handleAIGenerate, handleApplyAIPersona は変更なし）…

  const originalAccountId = account?.accountId;

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
          /** ▼追加送信 */
          secondStageContent: secondStageContent || "",
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
      {/* …モーダル類は省略… */}
      <form
        className="bg-white p-8 rounded shadow-lg min-w-[600px] max-h-[90vh] overflow-y-auto relative"
        onSubmit={handleSubmit}
      >
        {/* …既存フォーム項目は省略… */}

        <label className="block">自動投稿グループ</label>
        <select
          className="mb-4 border px-2 py-1 rounded w-full"
          value={groupId}
          onChange={e => setGroupId(e.target.value)}
        >
          <option value="">選択してください</option>
          {groups.map((g: AutoPostGroupType) => (
            <option key={g.groupKey} value={g.groupKey}>
              {g.groupName}
            </option>
          ))}
        </select>

        {/* ▼追加UI */}
        <label className="block font-semibold mt-4">
          2段階投稿（Threads用テキスト）
        </label>
        <textarea
          className="border rounded p-2 w-full mb-4 min-h-[80px] resize-y"
          placeholder="例: 1回目投稿の◯分後にThreadsへ投稿する文章"
          value={secondStageContent}
          onChange={(e) => setSecondStageContent(e.target.value)}
        />

        <div className="text-right mt-6">
          <button
            type="submit"
            className="bg-blue-500 text-white rounded px-5 py-2 hover:bg-blue-600 mr-2"
            disabled={saving}
          >
            {mode === "edit" ? "保存" : "登録"}
          </button>
          <button
            type="button"
            className="bg-gray-300 text-gray-800 rounded px-4 py-2"
            onClick={onClose}
            disabled={saving}
          >
            キャンセル
          </button>
        </div>
      </form>
    </div>
  );
}
