"use client";

import React, { useEffect, useState } from "react";

type AccountType = {
  accountId: string;
  displayName: string;
  personaSimple?: string;
  personaDetail?: string;
  personaMode?: string;
};

type AccountCopyModalProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (account: any) => void;
};

export default function AccountCopyModal({ open, onClose, onSelect }: AccountCopyModalProps) {
  const [accounts, setAccounts] = useState<AccountType[]>([]);
  const [selected, setSelected] = useState<AccountType | null>(null);

  useEffect(() => {
    if (open) {
      fetch(`/api/threads-accounts`, { credentials: "include" })
        .then((res) => res.json())
        .then((data) => setAccounts((data.accounts ?? data.items ?? []) as AccountType[]));
      setSelected(null);
    }
  }, [open]);

  if (!open) { return null; }

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
              {(() => {
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
              })()}
            </pre>
          </div>
        )}
        <div className="flex justify-end mt-3 gap-2">
          <button className="bg-gray-300 text-gray-800 px-4 py-2 rounded" onClick={onClose}>
            キャンセル
          </button>
          <button
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
            onClick={() => { if (selected) onSelect(selected); }}
            disabled={!selected}
          >
            この内容で複製
          </button>
        </div>
      </div>
    </div>
  );
}


