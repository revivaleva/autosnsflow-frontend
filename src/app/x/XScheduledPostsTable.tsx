"use client";

import React, { useEffect, useState } from "react";
import XPostModal from "./XScheduledPostModal";

type Scheduled = {
  scheduledPostId: string;
  accountId: string;
  content: string;
  scheduledAt: number;
  postedAt?: number;
  postId?: string;
  status?: string;
};

export default function XScheduledPostsTable() {
  const [posts, setPosts] = useState<Scheduled[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<Scheduled | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/x-scheduled-posts', { credentials: 'include' });
      if (!res.ok) throw new Error('load failed');
      const j = await res.json();
      setPosts(j.scheduledPosts || []);
    } catch (e) { setPosts([]); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleEdit = (p: Scheduled) => { setSelected(p); setModalOpen(true); };
  const handleCreate = () => { setSelected(null); setModalOpen(true); };

  return (
    <div className="max-w-5xl mx-auto mt-10">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">X 予約投稿一覧</h1>
        <div className="flex gap-2">
          <button className="bg-blue-500 text-white rounded px-4 py-2 hover:bg-blue-600" onClick={load}>再読み込み</button>
          <button className="bg-green-500 text-white rounded px-4 py-2 hover:bg-green-600" onClick={handleCreate}>＋予約作成</button>
        </div>
      </div>
      {loading ? (
        <div className="text-center py-8">読み込み中...</div>
      ) : (
        <table className="w-full border shadow bg-white dark:bg-gray-900 rounded overflow-hidden">
          <thead className="bg-gray-100 dark:bg-gray-800"><tr>
            <th className="py-2 px-3 text-left">アカウント</th>
            <th className="py-2 px-3 text-left">予約投稿日時</th>
            <th className="py-2 px-3 text-left">本文テキスト</th>
            <th className="py-2 px-3">投稿日時</th>
            <th className="py-2 px-3">投稿ID</th>
            <th className="py-2 px-3">アクション</th>
          </tr></thead>
          <tbody>
            {posts.map(p => (
              <tr key={p.scheduledPostId} className="border-t text-center">
                <td className="py-2 px-3 text-left"><button className="text-indigo-600 dark:text-indigo-300 hover:underline" onClick={() => {}}>{p.accountId}</button></td>
                <td className="py-2 px-3 text-left">{p.scheduledAt ? new Date(p.scheduledAt * 1000).toLocaleString() : ''}</td>
                <td className="py-2 px-3 text-left">{p.content && p.content.length > 80 ? p.content.slice(0,80) + '…' : p.content}</td>
                <td className="py-2 px-3">{p.postedAt ? new Date(p.postedAt * 1000).toLocaleString() : '-'}</td>
                <td className="py-2 px-3">{p.postId || '-'}</td>
                <td className="py-2 px-3">
                  <div className="flex gap-2 justify-center">
                    {(!p.postedAt || p.postedAt === 0) && (
                      <button className="px-2 py-1 bg-green-600 text-white rounded" onClick={async () => {
                        try {
                          const res = await fetch('/api/x/tweet', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: p.accountId, text: p.content }) });
                          if (!res.ok) throw new Error(await res.text());
                          alert('投稿しました');
                          await load();
                        } catch (e) { alert('投稿失敗: ' + String(e)); }
                      }}>即時投稿</button>
                    )}
                    <button className="px-2 py-1 border rounded" onClick={() => handleEdit(p)}>編集</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <XPostModal open={modalOpen} onClose={() => { setModalOpen(false); load(); }} post={selected} />
    </div>
  );
}


