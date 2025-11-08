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
  // 累積投稿失敗回数（UIで3回以上で赤表示）
  failureCount?: number;
};

export default function XAccountsTable({ onlyType }: { onlyType?: string } = {}) {
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
      let items = j.accounts || [];
      if (onlyType) {
        items = items.filter((a: any) => (a.type || 'general') === onlyType);
      }
      setAccounts(items);
    } catch (e) { setAccounts([]); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAdd = () => { setModalMode('create'); setSelected(null); setModalOpen(true); };
  const handleEdit = (acc: XAccount) => { setModalMode('edit'); setSelected(acc); setModalOpen(true); };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <div />
        <div className="flex gap-2">
          <button className="bg-blue-500 dark:bg-blue-600 text-white px-3 py-1 rounded" onClick={load}>再読み込み</button>
          <button className="bg-green-500 dark:bg-green-600 text-white px-3 py-1 rounded" onClick={handleAdd}>＋新規追加</button>
        </div>
      </div>
      {loading ? <div className="text-center py-8">読み込み中...</div> : (
        <table className="w-full border border-gray-200 dark:border-gray-700">
          <thead className="bg-gray-100 dark:bg-gray-800"><tr>
            <th className="py-2 px-3 text-left text-gray-900 dark:text-gray-100">アカウント名</th>
            <th className="py-2 px-3 text-gray-900 dark:text-gray-100">ID</th>
            <th className="py-2 px-3 text-gray-900 dark:text-gray-100">登録日</th>
            <th className="py-2 px-3 text-gray-900 dark:text-gray-100">自動投稿</th>
            <th className="py-2 px-3 text-gray-900 dark:text-gray-100">アプリ</th>
          </tr></thead>
          <tbody>
            {accounts.map((a) => {
              const accFail = Number(a.failureCount || 0);
              const rowCls = accFail >= 3 ? 'bg-red-50 dark:bg-red-900/30' : '';
              return (
                <tr key={a.accountId} className={`${rowCls} border-t`}>
                  <td className="py-2 px-3 text-left"><button className="text-blue-600" onClick={() => handleEdit(a)}>{a.username}</button></td>
                  <td className="py-2 px-3">{a.accountId}</td>
                  <td className="py-2 px-3">{a.createdAt ? new Date(a.createdAt * 1000).toLocaleString() : ''}</td>
                  <td className="py-2 px-3">
                    <ToggleSwitch
                      checked={!!a.autoPostEnabled}
                      onChange={async (v: boolean) => {
                        // optimistic update
                        setAccounts(prev => prev.map(x => x.accountId === a.accountId ? { ...x, autoPostEnabled: v } : x));
                        try {
                          const res = await fetch('/api/x-accounts', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ accountId: a.accountId, autoPostEnabled: v })
                          });
                          const j = await res.json().catch(() => ({}));
                          if (!res.ok || !j?.ok) throw new Error(j?.error || res.statusText);
                        } catch (e) {
                          // rollback on error
                          setAccounts(prev => prev.map(x => x.accountId === a.accountId ? { ...x, autoPostEnabled: !!a.autoPostEnabled } : x));
                          alert(`自動投稿の切替に失敗しました: ${String(e)}`);
                        }
                      }}
                    />
                  </td>
                  <td className="py-2 px-3"><button className="bg-indigo-500 dark:bg-indigo-600 text-white px-2 py-1 rounded" onClick={() => { try { const name = String(a.accountId || '').replace(/^@/, ''); window.location.href = `mycontainers://open?name=${encodeURIComponent(name)}&url=${encodeURIComponent('https://x.com/' + name)}` } catch {} }}>アプリ</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <XAccountModal open={modalOpen} onClose={() => { setModalOpen(false); load(); }} mode={modalMode} account={selected} reload={load} />
    </div>
  );
}


