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
  const [filterStatus, setFilterStatus] = useState<string>(''); // '' | 'scheduled' | 'posted'
  const [filterAccount, setFilterAccount] = useState<string>('');
  const [sortKey, setSortKey] = useState<'scheduledAt' | 'postedAt'>('scheduledAt');
  const [sortAsc, setSortAsc] = useState<boolean>(true);

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
    <div className="max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <div />
        <div className="flex gap-2">
          <button className="bg-blue-500 text-white px-3 py-1 rounded" onClick={load}>再読み込み</button>
          <button className="bg-green-500 text-white px-3 py-1 rounded" onClick={handleCreate}>＋予約作成</button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center mb-3">
        <label className="text-sm">状態:</label>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border rounded px-2 py-1">
          <option value="">すべて</option>
          <option value="scheduled">未投稿</option>
          <option value="posted">投稿済</option>
        </select>
        <label className="text-sm">アカウント:</label>
        <select value={filterAccount} onChange={e => setFilterAccount(e.target.value)} className="border rounded px-2 py-1">
          <option value="">すべて</option>
          {[...new Set(posts.map(p => p.accountId))].map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-sm">ソート:</label>
          <select value={sortKey} onChange={e => setSortKey(e.target.value as any)} className="border rounded px-2 py-1">
            <option value="scheduledAt">予約日時</option>
            <option value="postedAt">投稿日時</option>
          </select>
          <button className="px-2 py-1 border rounded" onClick={() => setSortAsc(s => !s)}>{sortAsc ? '昇順' : '降順'}</button>
        </div>
      </div>

      {loading ? <div className="text-center py-8">読み込み中...</div> : (
        <table className="w-full border">
          <colgroup>
            <col style={{ width: '15%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '40%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '13%' }} />
          </colgroup>
          <thead className="bg-gray-100 dark:bg-gray-800"><tr>
            <th className="py-2 px-3 text-left text-gray-900 dark:text-gray-100">アカウント</th>
            <th className="py-2 px-3 text-left text-gray-900 dark:text-gray-100">予約投稿日時</th>
            <th className="py-2 px-3 text-left text-gray-900 dark:text-gray-100">本文テキスト</th>
            <th className="py-2 px-3 text-gray-900 dark:text-gray-100">投稿日時</th>
            <th className="py-2 px-3 text-gray-900 dark:text-gray-100">投稿ID</th>
            <th className="py-2 px-3 w-96 text-gray-900 dark:text-gray-100">アクション</th>
          </tr></thead>
          <tbody>
            {posts
              .filter(p => (filterStatus ? (filterStatus === 'posted' ? !!p.postedAt : !p.postedAt) : true))
              .filter(p => (filterAccount ? p.accountId === filterAccount : true))
              .sort((a,b) => {
                const ka = sortKey === 'scheduledAt' ? (a.scheduledAt||0) : (a.postedAt||0);
                const kb = sortKey === 'scheduledAt' ? (b.scheduledAt||0) : (b.postedAt||0);
                return sortAsc ? ka - kb : kb - ka;
              })
              .map(p => (
              <tr key={p.scheduledPostId} className="border-t">
                <td className="py-2 px-3 text-left"><button className={`text-blue-600 ${!p.postedAt ? 'underline' : ''}`} onClick={() => { if (!p.postedAt) { setSelected(p); setModalOpen(true); } }}>{p.accountId}</button></td>
                <td className="py-2 px-3 text-left">{p.scheduledAt ? new Date(p.scheduledAt * 1000).toLocaleString() : ''}</td>
                <td className="py-2 px-3 text-left align-middle">
                  <div style={{display: '-webkit-box', WebkitLineClamp: 2 as any, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden'}} title={p.content || ''}>
                    {p.content || ''}
                  </div>
                </td>
                <td className="py-2 px-3 w-72">{p.postedAt ? new Date(p.postedAt * 1000).toLocaleString() : '-'}</td>
                <td className="py-2 px-3 w-72">{p.postId || '-'}</td>
                <td className="py-2 px-3 w-96">
                  <div className="flex gap-3 justify-center items-center">
                    {(p.status !== 'posted') ? (
                      <>
                        <button className="px-6 py-2 bg-green-600 text-white rounded min-w-[140px]" onClick={async () => {
                          // Confirm and debug logging
                          if (typeof window === 'undefined' || !window.confirm('即時投稿を実行しますか？')) return;
                          const url = '/api/x/tweet';
                          const payload = { accountId: p.accountId, text: p.content };
                          try {
                            try { console.info('[x-manual-post] request', { url, payload }); } catch(_) {}
                            const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                            const body = await res.json().catch(async () => { try { return JSON.parse(await res.text()); } catch(_) { return {}; } });
                            try { console.info('[x-manual-post] response', { status: res.status, ok: res.ok, body }); } catch(_) {}
                            if (!res.ok) throw new Error(body?.error || (body && JSON.stringify(body)) || String(res.status));
                            await load();
                          } catch (e) { alert('投稿失敗: ' + String(e)); }
                        }}>即時投稿</button>
                        <button className="px-6 py-2 rounded bg-red-600 text-white min-w-[140px]" onClick={async () => {
                          if (!confirm('本当に削除しますか？')) return;
                          try {
                            const res = await fetch('/api/x-scheduled-posts', { method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scheduledPostId: p.scheduledPostId }) });
                            if (!res.ok) throw new Error(await res.text());
                            await load();
                          } catch (e) { alert('削除に失敗しました: ' + String(e)); }
                        }}>削除</button>
                      </>
                    ) : (
                      <span className="text-sm text-gray-600">投稿済</span>
                    )}
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


