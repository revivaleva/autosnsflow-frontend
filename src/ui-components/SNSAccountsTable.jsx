// /src/ui-components/SNSAccountsTable.jsx

"use client";

import React, { useState } from "react";
import { ToggleSwitch } from "./ToggleSwitch";
import SNSAccountModal from "./SNSAccountModal";

// 状態（statusMessage）を追加したサンプルデータ
const initialAccounts = [
  {
    id: "1",
    displayName: "メインアカウント",
    accountId: "@main_account",
    platform: "Twitter", // ← プラットフォーム列は削除するため後で出力から除外
    createdAt: "2025/8/4 16:25",
    autoPost: true,
    autoGenerate: true,
    autoReply: false,
    statusMessage: "自動稼働中", // 追加
  },
  {
    id: "2",
    displayName: "副業アカウント",
    accountId: "@sub_account",
    platform: "Threads",
    createdAt: "2025/8/4 16:25",
    autoPost: false,
    autoGenerate: false,
    autoReply: true,
    statusMessage: "エラー停止中", // 追加
  }
];

export default function SNSAccountsTable() {
  const [accounts, setAccounts] = useState(initialAccounts);

  // モーダルの開閉と編集対象
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create"); // "create" or "edit"
  const [selectedAccount, setSelectedAccount] = useState(null);

  // トグル切替
  const handleToggle = (id, key) => {
    setAccounts(accounts =>
      accounts.map(acc =>
        acc.id === id ? { ...acc, [key]: !acc[key] } : acc
      )
    );
  };

  // 新規追加ボタン押下
  const handleAddClick = () => {
    setModalMode("create");
    setSelectedAccount(null);
    setModalOpen(true);
  };

  // 編集ボタン押下
  const handleEditClick = (account) => {
    setModalMode("edit");
    setSelectedAccount(account);
    setModalOpen(true);
  };

  // モーダル閉じる
  const handleCloseModal = () => {
    setModalOpen(false);
  };

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
            <th className="py-2 px-3 w-36">状態</th> {/* 状態カラム追加 */}
            <th className="py-2 px-3 w-20"></th>
          </tr>
        </thead>
        <tbody>
          {accounts.map(acc => (
            <tr key={acc.id} className="text-center border-t">
              <td className="py-2 px-3">{acc.displayName}</td>
              <td className="py-2 px-3">{acc.accountId}</td>
              <td className="py-2 px-3">{acc.createdAt}</td>
              <td className="py-2 px-3">
                <ToggleSwitch checked={acc.autoPost} onChange={() => handleToggle(acc.id, "autoPost")} />
              </td>
              <td className="py-2 px-3">
                <ToggleSwitch checked={acc.autoGenerate} onChange={() => handleToggle(acc.id, "autoGenerate")} />
              </td>
              <td className="py-2 px-3">
                <ToggleSwitch checked={acc.autoReply} onChange={() => handleToggle(acc.id, "autoReply")} />
              </td>
              <td className="py-2 px-3">{acc.statusMessage}</td>
              <td className="py-2 px-3">
                <button
                  className="bg-blue-500 text-white rounded px-3 py-1 hover:bg-blue-600"
                  onClick={() => handleEditClick(acc)}
                >
                  編集
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
      />
    </div>
  );
}
