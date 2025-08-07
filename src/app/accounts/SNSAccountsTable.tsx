// /src/app/accounts/SNSAccountsTable.tsx

"use client";

import React, { useEffect, useState } from "react";
import { ToggleSwitch } from "@/components/ToggleSwitch";
import SNSAccountModal from "./SNSAccountModal";

// 型定義（共通型は types ディレクトリ等に分離してもOK）
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
};

export default function SNSAccountsTable() {
  const [accounts, setAccounts] = useState<ThreadsAccount[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // モーダル関連
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [selectedAccount, setSelectedAccount] = useState<ThreadsAccount | null>(null);

  // 一覧取得処理を関数化
  const loadAccounts = async () => {
    const userId = localStorage.getItem("userId");
    if (!userId) return;
    setLoading(true);
    const res = await fetch(`/api/threads-accounts?userId=${userId}`);
    const data = await res.json();
    setAccounts(data.accounts ?? []);
    setLoading(false);
  };

  // 初回マウント時のみAPI取得
  useEffect(() => {
    loadAccounts();
  }, []);

  // 楽観的UIトグル
  const handleToggle = async (acc: ThreadsAccount, field: keyof ThreadsAccount) => {
    const userId = localStorage.getItem("userId");
    if (!userId) return;
    const newVal = !acc[field];
    setAccounts(prev =>
      prev.map(a =>
        a.accountId === acc.accountId ? { ...a, [field]: newVal } : a
      )
    );
    await fetch("/api/threads-accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        accountId: acc.accountId,
        updateFields: { [field]: newVal }
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
    const userId = localStorage.getItem("userId");
    if (!userId) return;
    if (!window.confirm("本当に削除しますか？")) return;
    const res = await fetch(`/api/threads-accounts`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
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
            <th className="py-2 px-3 w-20"></th>
          </tr>
        </thead>
        <tbody>
          {accounts.map(acc => (
            <tr key={acc.accountId} className="text-center border-t">
              <td className="py-2 px-3">{acc.displayName}</td>
              <td className="py-2 px-3">{acc.accountId}</td>
              <td className="py-2 px-3">{acc.createdAt
                ? new Date(acc.createdAt * 1000).toLocaleString()
                : ""}
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
              <td className="py-2 px-3">
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
