 "use client";

import React, { useEffect, useState } from "react";

type PoolItem = {
  poolId: string;
  type: string;
  content: string;
  images: string[];
  createdAt?: number;
};

export default function PostPoolPage({ poolType }: { poolType: "general" | "ero" | "saikyou" }) {
  const [content, setContent] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [items, setItems] = useState<PoolItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [accountsCount, setAccountsCount] = useState<number>(0);
  const [generalCount, setGeneralCount] = useState<number>(0);
  const [eroCount, setEroCount] = useState<number>(0);
  const [saikyouCount, setSaikyouCount] = useState<number>(0);
  const [xAccountsCount, setXAccountsCount] = useState<number>(0);
  const [openPool, setOpenPool] = useState<boolean>(false);
  const [openScheduled, setOpenScheduled] = useState<boolean>(false);
  const [scheduledPostsX, setScheduledPostsX] = useState<any[]>([]);

  useEffect(() => { loadPool(); loadAccountsCount(); }, [poolType]);
  useEffect(() => {
    if (openScheduled && poolType) {
      loadScheduledX();
    }
  }, [openScheduled, poolType]);

  // Load X scheduled posts for this pool view. Query X scheduled posts and X accounts,
  // filter accounts by poolType (general|ero) and display posts belonging to those accounts.
  const loadScheduledX = async () => {
    try {
      const [xr, xa] = await Promise.all([
        fetch('/api/x-scheduled-posts', { credentials: 'include' }),
        fetch('/api/x-accounts', { credentials: 'include' }),
      ]);
      const xposts = xr.ok ? (await xr.json()).scheduledPosts || [] : [];
      const xaccResp = xa.ok ? (await xa.json()) : {};
      const xaccounts: any[] = xaccResp.accounts || xaccResp.items || [];
      // filter x accounts by poolType
      const filteredAccountIds = new Set(xaccounts.filter((a: any) => (a.type || 'general') === poolType).map(a => a.accountId));
      const posts = (xposts as any[]).filter((p: any) => filteredAccountIds.has(p.accountId));
      // ensure accountName present
      const postsWithNames = posts.map((p: any) => {
        const acc = xaccounts.find(a => a.accountId === p.accountId);
        return { ...p, accountName: acc ? (acc.displayName || acc.username || acc.accountName || '') : (p.accountName || '') };
      });
      setScheduledPostsX(postsWithNames);
    } catch (e) {
      setScheduledPostsX([]);
    }
  };

  const loadPool = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/post-pool?type=${encodeURIComponent(poolType)}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      const j = await res.json();
      setItems(j.items || []);
    } catch (e) {
      setItems([]);
    } finally { setLoading(false); }
  };

  const loadAccountsCount = async () => {
    try {
      // Use X accounts as the source of truth for pool counts (general/ero)
      const xr = await fetch("/api/x-accounts", { credentials: "include" });
      if (!xr.ok) {
        setAccountsCount(0);
        setGeneralCount(0);
        setEroCount(0);
        setXAccountsCount(0);
        return;
      }
      const xj = await xr.json().catch(() => ({}));
      const xlist: any[] = xj.items || xj.accounts || [];
      const general = xlist.filter((a: any) => (a.type || "general") === "general").length;
      const ero = xlist.filter((a: any) => (a.type || "general") === "ero").length;
      const saikyou = xlist.filter((a: any) => (a.type || "general") === "saikyou").length;
      setGeneralCount(general);
      setEroCount(ero);
      setSaikyouCount(saikyou);
      setXAccountsCount(Array.isArray(xlist) ? xlist.length : 0);
      const filteredCount = xlist.filter((a: any) => (a.type || "general") === poolType).length;
      setAccountsCount(filteredCount);
    } catch (e) {
      setAccountsCount(0);
      setGeneralCount(0);
      setEroCount(0);
      setXAccountsCount(0);
    }
  };

  const handleImageSelect = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const files = ev.target.files ? Array.from(ev.target.files) : [];
    setImages(files);
  };

  const handleSave = async () => {
    if (!content || content.trim().length === 0) {
      alert("本文を入力してください");
      return;
    }
    setLoading(true);
    try {
      // For now, ignore image upload and send images as empty
      const resp = await fetch("/api/post-pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type: poolType, content: content.trim(), images: [] }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || !j.ok) throw new Error(j.error || "save_failed");
      setContent("");
      setImages([]);
      await loadPool();
    } catch (e: any) {
      alert("保存に失敗しました: " + String(e?.message || e));
    } finally { setLoading(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("この投稿をプールから削除しますか？")) return;
    try {
      const r = await fetch("/api/post-pool", { method: "DELETE", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ poolId: id }) });
      if (!r.ok) throw new Error("delete_failed");
      await loadPool();
    } catch (e) {
      alert("削除に失敗しました");
    }
  };

  const poolCount = items.length;
  const relevantAccountCount =
    poolType === "general" ? generalCount : poolType === "ero" ? eroCount : saikyouCount;
  const postsPerDayPerAcc = relevantAccountCount * 3;
  const daysCover = postsPerDayPerAcc > 0 ? Math.floor(poolCount / postsPerDayPerAcc) : null;
  const possibleDate = daysCover === null ? "計算不可" : new Date(Date.now() + (daysCover * 24 * 3600 * 1000)).toLocaleDateString();

  return (
    <div className="max-w-6xl mx-auto mt-8 p-4">
      <div className="mb-6">
        <div className="text-sm text-gray-600">
          プール件数: <strong>{poolCount}</strong> ・ アカウント数: <strong>{accountsCount}</strong>
        </div>
        {/* 表示は該当種別のみ（投稿可能期日計算用） */}
        <div className="text-sm text-gray-600">投稿可能期日: <strong>{possibleDate}</strong>（保有日数: {daysCover === null ? "－" : `${daysCover}日`})</div>
      </div>

      <div className="mb-4">
        <textarea className="w-full border rounded p-2 min-h-[300px]" value={content} onChange={(e) => setContent(e.target.value)} placeholder="投稿本文を入力（改行可）"></textarea>
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-2">
            <label className="bg-gray-100 px-3 py-1 rounded cursor-pointer">
              画像
              <input type="file" accept="image/*" multiple onChange={handleImageSelect} className="hidden" />
            </label>
          </div>
            <div className="flex items-center gap-2">
            <div className="text-sm text-gray-500">文字数: {String(content || "").length}</div>
            <button className="bg-green-500 text-white px-4 py-2 rounded text-sm font-medium" onClick={handleSave} disabled={loading}>{loading ? "登録中..." : "登録"}</button>
          </div>
        </div>
      </div>

      {/* タブは折りたたみ可能にする */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-2 cursor-pointer" onClick={() => setOpenPool((s) => !s)}>
          プール一覧 {openPool ? "▲" : "▼"}
        </h2>
      </div>

      {openPool && (
        <div className="mb-6">
          <div className="mb-4 flex justify-end gap-2">
            <button className="bg-blue-500 text-white rounded px-3 py-1 text-sm" onClick={loadPool}>再読み込み</button>
          </div>
          {loading ? <div>読み込み中...</div> : (
            <table className="w-full border">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-left">本文</th>
                  <th className="p-2 text-right" style={{ width: 140 }}>作成日</th>
                  <th className="p-2 text-center" style={{ width: 100 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.poolId} className="border-t">
                    <td className="px-2 py-1 align-top" style={{ verticalAlign: 'top' }}>
                      <div
                        title={it.content}
                        className="text-sm"
                        style={{
                          whiteSpace: 'pre-line',
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          height: '3rem',
                          minHeight: '3rem',
                          lineHeight: '1rem',
                        }}
                      >
                        {it.content}
                      </div>
                    </td>
                    <td className="px-2 py-1 text-right text-sm text-gray-600">{it.createdAt ? new Date(it.createdAt * 1000).toLocaleString() : ""}</td>
                    <td className="px-2 py-1 text-center">
                      <button className="bg-red-500 text-white px-2 py-1 rounded" onClick={() => handleDelete(it.poolId)}>削除</button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={3} className="p-4 text-center text-gray-500">データがありません</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-2 cursor-pointer" onClick={() => { setOpenScheduled((s) => !s); if (!openScheduled) loadScheduledX(); }}>予約投稿一覧 {openScheduled ? "▲" : "▼"}</h2>
        {openScheduled && (
          <div>
            <div className="mb-4 flex justify-end gap-2">
              <button className="bg-blue-500 text-white rounded px-3 py-1 text-sm" onClick={loadScheduledX}>再読み込み</button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full bg-white border">
                <thead>
                  <tr>
                    <th className="border p-2" style={{ width: 260 }}>アカウント</th>
                    <th className="border p-2" style={{ width: 180 }}>予約投稿日時</th>
                    <th className="border p-2" style={{ width: 520 }}>本文テキスト</th>
                    <th className="border p-2" style={{ width: 160 }}>投稿日時</th>
                    <th className="border p-2" style={{ width: 160 }}>投稿ID</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduledPostsX.map((p) => (
                    <tr key={p.scheduledPostId} className="border-t">
                      <td className="px-2 py-1">
                        <div className="text-sm font-medium" style={{ lineHeight: '1rem', maxHeight: '3rem', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }} title={p.content || ''}>{p.accountName}</div>
                        <div className="text-xs text-gray-500">{p.accountId}</div>
                      </td>
                      <td className="px-2 py-1">{p.scheduledAt ? (typeof p.scheduledAt === 'number' ? new Date(p.scheduledAt * 1000).toLocaleString() : String(p.scheduledAt)) : ''}</td>
                      <td className="px-2 py-1">
                        <div className="text-sm" style={{ whiteSpace: 'pre-line', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', height: '3rem', minHeight: '3rem', lineHeight: '1rem' }} title={p.content || ''}>
                          {p.content}
                        </div>
                      </td>
                      <td className="px-2 py-1">{p.postedAt ? (typeof p.postedAt === 'number' ? new Date(p.postedAt * 1000).toLocaleString() : String(p.postedAt)) : ''}</td>
                      <td className="px-2 py-1">
                        {p.status === 'posted' && p.postId ? (
                          <a href={`https://www.threads.net/post/${p.postId}`} target="_blank" rel="noreferrer" className="text-blue-600 underline">{String(p.postId).slice(0,30)}</a>
                        ) : ''}
                      </td>
                    </tr>
                  ))}
                  {scheduledPostsX.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-gray-500">データがありません</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


