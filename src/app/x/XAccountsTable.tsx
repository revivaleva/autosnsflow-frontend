"use client";

import React, { useEffect, useState } from "react";
import ToggleSwitch from "@/components/ToggleSwitch";
import XAccountModal from "./XAccountModal";

type XAccount = {
  accountId: string;
  username: string;
  createdAt?: number;
  autoPostEnabled?: boolean;
  authState?: string;
};

export default function XAccountsTable() {
  const [accounts, setAccounts] = useState<XAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [selected, setSelected] = useState<XAccount | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/x-accounts', { credentials: 'include' });
      if (!res.ok) throw new Error('failed');
      const j = await res.json();
      const items = j.accounts || [];
      setAccounts(items);
    } catch (e) { setAccounts([]); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAdd = () => { setModalMode('create'); setSelected(null); setModalOpen(true); };
  const handleEdit = (acc: XAccount) => { setModalMode('edit'); setSelected(acc); setModalOpen(true); };

  return (
    <div className="max-w-5xl mx-auto mt-10">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Xアカウント一覧</h1>
        </div>
        <div className="flex gap-2">
          <button className="bg-blue-500 text-white rounded px-4 py-2 hover:bg-blue-600" onClick={load}>再読み込み</button>
          <button className="bg-green-500 text-white rounded px-4 py-2 hover:bg-green-600" onClick={handleAdd}>＋新規追加</button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8">読み込み中...</div>
      ) : (
        <table className="w-full border shadow bg-white dark:bg-gray-900 rounded overflow-hidden">
          <thead className="bg-gray-100 dark:bg-gray-800">
            <tr>
              <th className="py-2 px-3 text-left">アカウント名</th>
              <th className="py-2 px-3">ID</th>
              <th className="py-2 px-3">登録日</th>
              <th className="py-2 px-3">自動投稿</th>
              <th className="py-2 px-3">アプリ</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.accountId} className="border-t text-center">
                <td className="py-2 px-3 text-left">
                  <button className="text-indigo-600 dark:text-indigo-300 hover:underline" onClick={() => handleEdit(a)}>{a.username || a.accountId}</button>
                </td>
                <td className="py-2 px-3">{a.accountId}</td>
                <td className="py-2 px-3">{a.createdAt ? new Date(a.createdAt * 1000).toLocaleString() : ''}</td>
                <td className="py-2 px-3"><ToggleSwitch checked={!!a.autoPostEnabled} onChange={() => {}} disabled /></td>
                <td className="py-2 px-3">
                  <button className="bg-indigo-500 text-white px-3 py-1 rounded hover:bg-indigo-600" onClick={() => { try { const name = String(a.accountId || '').replace(/^@/, ''); window.location.href = `mycontainers://open?name=${encodeURIComponent(name)}&url=${encodeURIComponent('https://x.com/' + name)}` } catch {} }}>アプリ</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <XAccountModal open={modalOpen} onClose={() => { setModalOpen(false); load(); }} mode={modalMode} account={selected} reload={load} />
    </div>
  );
}


