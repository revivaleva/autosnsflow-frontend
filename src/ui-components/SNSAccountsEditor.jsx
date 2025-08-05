// src/ui-components/SNSAccountsEditor.jsx

import React, { useState } from "react";
import SNSAccountsTable from "./SNSAccountsTable";
import SNSAccountCreateForm from "./SNSAccountCreateForm";
import SNSAccountUpdateForm from "./SNSAccountUpdateForm";
import { PlusIcon } from "lucide-react";

// 他画面と合わせ、Chakra UI等ライブラリは使わず、全てTailwind+自作モーダルUIで記述

const initialAccounts = [
  {
    accountId: "demo_account_1",
    accessToken: "token_xxxxx",
    displayName: "デモアカウント1",
  },
  {
    accountId: "demo_account_2",
    accessToken: "token_yyyyy",
    displayName: "デモアカウント2",
  },
];

export default function SNSAccountsEditor() {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);

  // 追加
  const handleCreate = (account) => {
    setAccounts((prev) => [...prev, account]);
    setIsCreateOpen(false);
  };

  // 編集開始
  const handleEdit = (account) => {
    setEditingAccount(account);
    setIsEditOpen(true);
  };

  // 編集反映
  const handleUpdate = (updatedAccount) => {
    setAccounts((prev) =>
      prev.map((a) => (a.accountId === updatedAccount.accountId ? updatedAccount : a))
    );
    setIsEditOpen(false);
    setEditingAccount(null);
  };

  // 削除
  const handleDelete = (accountId) => {
    setAccounts((prev) => prev.filter((a) => a.accountId !== accountId));
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-2 py-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">SNSアカウント一覧</h2>
        <button
          className="flex items-center gap-2 rounded border px-4 py-2 text-sm font-medium shadow hover:bg-gray-50 transition"
          onClick={() => setIsCreateOpen(true)}
        >
          <PlusIcon className="w-4 h-4" />
          追加
        </button>
      </div>

      {/* 一覧 */}
      <SNSAccountsTable accounts={accounts} onEdit={handleEdit} onDelete={handleDelete} />

      {/* 追加モーダル */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-30 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="text-lg font-bold">アカウント追加</h3>
              <button
                className="text-gray-400 hover:text-gray-700"
                onClick={() => setIsCreateOpen(false)}
                aria-label="閉じる"
              >
                ×
              </button>
            </div>
            <div className="p-4">
              <SNSAccountCreateForm
                onSubmit={handleCreate}
                onCancel={() => setIsCreateOpen(false)}
              />
            </div>
          </div>
        </div>
      )}

      {/* 編集モーダル */}
      {isEditOpen && editingAccount && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-30 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="text-lg font-bold">アカウント編集</h3>
              <button
                className="text-gray-400 hover:text-gray-700"
                onClick={() => setIsEditOpen(false)}
                aria-label="閉じる"
              >
                ×
              </button>
            </div>
            <div className="p-4">
              <SNSAccountUpdateForm
                account={editingAccount}
                onSubmit={handleUpdate}
                onCancel={() => setIsEditOpen(false)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
