// src/ui-components/SNSAccountModal.jsx
import React from "react";

export default function SNSAccountModal({ open, onClose, mode = "create", account }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
      <div className="bg-white p-8 rounded shadow-lg min-w-[400px] relative">
        <button
          className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
          onClick={onClose}
        >×</button>
        <h2 className="text-xl font-bold mb-4">
          {mode === "edit" ? "アカウント編集" : "新規アカウント追加"}
        </h2>
        <div className="mb-4">
          {mode === "edit" && account ? (
            <pre className="text-xs bg-gray-100 p-2 rounded">{JSON.stringify(account, null, 2)}</pre>
          ) : (
            <span>ここに登録・編集フォームを作成</span>
          )}
        </div>
        <button
          className="bg-blue-500 text-white rounded px-4 py-2 hover:bg-blue-600 mr-2"
          onClick={onClose}
        >閉じる</button>
      </div>
    </div>
  );
}
