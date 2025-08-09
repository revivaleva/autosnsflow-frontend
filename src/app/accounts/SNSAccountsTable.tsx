// src/app/accounts/SNSAccountsTable.tsx

"use client";

import React, { useEffect, useState } from "react";
import { ToggleSwitch } from "@/components/ToggleSwitch";
import SNSAccountModal from "./SNSAccountModal";

// 型定義
export type ThreadsAccount = {
  accountId: string;
  displayName: string;
  createdAt: number;
  autoPost: boolean;
  autoGenerate: boolean;
  autoReply: boolean;
  statusMessage: string;
  personaMode: string;
  personaSimple: string;
  personaDetail: string;
  autoPostGroupId: string;
  /** ▼追加: 2段階投稿用のThreads投稿本文 */
  secondStageContent?: string;
};

export default function SNSAccountsTable() {
  const [accounts, setAccounts] = useState<ThreadsAccount[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // モーダル関連
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [selectedAccount, setSelectedAccount] = useState<ThreadsAccount | null>(null);

  // 一覧取得処理
  const loadAccounts = async () => {
    setLoading(true);
    const res = await fetch(`/api/threads-accounts`, { credentials: "include" });
    const data = await res.json();
    setAccounts(data.accounts ?? []);
    setLoading(false);
  };

  // 初回マウント時のみAPI取得
  useEffect(() => {
    loadAccounts();
  }, []);

  // テキストのトリミング（2段階投稿の長文を短縮表示用）
  const truncate = (text: string, max = 30) => {
    if (!text) return "";
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  // 楽観的UIトグル（対象はブール値のみ）
  const handleToggle = async (
    acc: ThreadsAccount,
    field: "autoPost" | "autoGenerate" | "autoReply" // ←型を限定
  ) => {
    const newVal = !acc[field];
    setAccounts((prev) =>
      prev.map((a) => (a.accountId === acc.accountId ? { ...a, [field]: newVal } : a))
    );
    await fetch("/api/threads-accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        accountId: acc.accountId,
        updateFields: { [field]: newVal },
      }),
    });
  };

  const handleAddClick = () => {
    setModalMode("create");
    setSelectedAccount(null);
    setModalOpen(true);
  };

  const handleEditClick = (account: ThreadsAccount) => {
    setModalMode("edit");
    setSelectedAccount(account);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
  };

  // 削除
  const handleDelete = async (acc: ThreadsAccount) => {
    if (!window.confirm("本当に削除しますか？")) return;
    const res = await fetch(`/api/threads-accounts`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        accountId: acc.accountId,
      }),
    });
    const data = await res.json();
    if (data.success) {
      loadAccounts();
    } else {
      alert("削除失敗: " + (data.error || ""));
    }
  };

  if (loading) return <div className="text-center py-8">読み込み中...</div>;

  return (
    <div className="max-w-5xl mx-auto mt-10">
      <h1 className="text-2xl font-bold mb-6 text-center">SNSアカウント一覧</h1>
      <div className="mb-3 flex justify-end">
        <button
          className="bg-green-500 text-white rounded px-4 py-2 hover:bg-green-600"
          onClick={handleAddClick}
        >
          ＋新規追加
        </button>
      </div>
      <table className="w-full border shadow bg-white rounded overflow-hidden">
        <thead className="bg-gray-100">
          <tr>
            <th className="py-2 px-3 w-32">アカウント名</th>
            <th className="py-2 px-3 w-44">アカウントID</th>
            <th className="py-2 px-3 w-36">作成日</th>
            <th className="py-2 px-3 w-28">自動投稿</th>
            <th className="py-2 px-3 w-28">本文生成</th>
            <th className="py-2 px-3 w-28">リプ返信</th>
            <th className="py-2 px-3 w-36">状態</th>
            {/* ▼追加カラム：2段階投稿の有無／冒頭プレビュー */}
            <th className="py-2 px-3 w-52">2段階投稿</th>
            <th className="py-2 px-3 w-20"></th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((acc) => (
            <tr key={acc.accountId} className="text-center border-t">
              <td className="py-2 px-3">{acc.displayName}</td>
              <td className="py-2 px-3">{acc.accountId}</td>
              <td className="py-2 px-3">
                {acc.createdAt ? new Date(acc.createdAt * 1000).toLocaleString() : ""}
              </td>
              <td className="py-2 px-3">
                <ToggleSwitch
                  checked={!!acc.autoPost}
                  onChange={() => handleToggle(acc, "autoPost")}
                />
              </td>
              <td className="py-2 px-3">
                <ToggleSwitch
                  checked={!!acc.autoGenerate}
                  onChange={() => handleToggle(acc, "autoGenerate")}
                />
              </td>
              <td className="py-2 px-3">
                <ToggleSwitch
                  checked={!!acc.autoReply}
                  onChange={() => handleToggle(acc, "autoReply")}
                />
              </td>
              <td className="py-2 px-3">{acc.statusMessage || ""}</td>
              {/* ▼追加セル：2段階投稿の本文冒頭（最大30文字）を表示、未設定はダッシュ */}
              <td className="py-2 px-3 text-left">
                {acc.secondStageContent && acc.secondStageContent.trim().length > 0
                  ? truncate(acc.secondStageContent, 30)
                  : "—"}
              </td>
              <td className="py-2 px-3">
                <div className="flex items-center justify-center gap-2">
                  <button
                    className="bg-blue-500 text-white rounded px-3 py-1 hover:bg-blue-600"
                    onClick={() => handleEditClick(acc)}
                  >
                    編集
                  </button>
                  <button
                    className="bg-red-500 text-white rounded px-3 py-1 hover:bg-red-600"
                    onClick={() => handleDelete(acc)}
                  >
                    削除
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* モーダル表示 */}
      <SNSAccountModal
        open={modalOpen}
        onClose={handleCloseModal}
        mode={modalMode}
        account={selectedAccount}
        reloadAccounts={loadAccounts}
      />
    </div>
  );
}
