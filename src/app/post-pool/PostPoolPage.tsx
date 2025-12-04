 "use client";

import React, { useEffect, useState } from "react";
import ImportModal from "./ImportModal";

type PoolItem = {
  poolId: string;
  type: string;
  content: string;
  images: string[];
  createdAt?: number;
};

export default function PostPoolPage({ poolType }: { poolType: "general" | "ero" | "ero1" | "ero2" | "saikyou" }) {
  const [content, setContent] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [items, setItems] = useState<PoolItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [accountsCount, setAccountsCount] = useState<number>(0);
  const [generalCount, setGeneralCount] = useState<number>(0);
  const [eroCount, setEroCount] = useState<number>(0);
  const [ero1Count, setEro1Count] = useState<number>(0);
  const [ero2Count, setEro2Count] = useState<number>(0);
  const [saikyouCount, setSaikyouCount] = useState<number>(0);
  const [xAccountsCount, setXAccountsCount] = useState<number>(0);
  const [openPool, setOpenPool] = useState<boolean>(false);
  const [openScheduled, setOpenScheduled] = useState<boolean>(false);
  const [openImport, setOpenImport] = useState<boolean>(false);
  const [scheduledPostsX, setScheduledPostsX] = useState<any[]>([]);
  const [xAccountsList, setXAccountsList] = useState<any[]>([]);
  const [morningOn, setMorningOn] = useState<boolean>(false);
  const [noonOn, setNoonOn] = useState<boolean>(false);
  const [nightOn, setNightOn] = useState<boolean>(false);
  const [reuseOn, setReuseOn] = useState<boolean>(false);
  const [settingLoading, setSettingLoading] = useState<boolean>(false);
  const [regenLoading, setRegenLoading] = useState<boolean>(false);
  const [filterStatus, setFilterStatus] = useState<string>(''); // '' | 'scheduled' | 'posted'
  const [filterAccount, setFilterAccount] = useState<string>('');
  const [sortKey, setSortKey] = useState<'scheduledAt' | 'postedAt'>('scheduledAt');
  const [sortAsc, setSortAsc] = useState<boolean>(false); // newest first by default
  const [postingXId, setPostingXId] = useState<string>(''); // X 即時投稿実行中フラグ

  useEffect(() => { loadPool(); loadAccountsCount(); }, [poolType]);
  useEffect(() => {
    // load user-type time settings for this poolType
    const load = async () => {
      try {
        setSettingLoading(true);
        const q = await fetch(`/api/user-type-time-settings?type=${encodeURIComponent(poolType)}`, { credentials: 'include' });
        if (!q.ok) { setMorningOn(false); setNoonOn(false); setNightOn(false); return; }
        const j = await q.json().catch(() => ({}));
        const it = j.item || {};
        setMorningOn(Boolean(it.morning === true || it.morning === 'true'));
        setNoonOn(Boolean(it.noon === true || it.noon === 'true'));
        setNightOn(Boolean(it.night === true || it.night === 'true'));
        setReuseOn(Boolean(it.reuse === true || it.reuse === 'true'));
      } catch (e) {
        setMorningOn(false); setNoonOn(false); setNightOn(false);
      } finally {
        setSettingLoading(false);
      }
    };
    load();
  }, [poolType]);
  useEffect(() => {
    if (openScheduled && poolType) {
      loadScheduledX();
    }
  }, [openScheduled, poolType]);
 
  const getVisibleScheduled = () => {
    return scheduledPostsX
      .filter((p: any) => (filterStatus ? (filterStatus === 'posted' ? !!p.postedAt : !p.postedAt) : true))
      .filter((p: any) => (filterAccount ? p.accountId === filterAccount : true))
      .sort((a: any, b: any) => {
        const ka = sortKey === 'scheduledAt' ? (a.scheduledAt || 0) : (a.postedAt || 0);
        const kb = sortKey === 'scheduledAt' ? (b.scheduledAt || 0) : (b.postedAt || 0);
        return sortAsc ? ka - kb : kb - ka;
      });
  };

  const exportScheduledCsv = () => {
    try {
      const visible = getVisibleScheduled();
      const rows = visible.map((p: any) => (p.content || '')).filter((s: string) => s && String(s).trim() !== '');
      if (rows.length === 0) {
        alert('エクスポートする投稿がありません（本文が空のものはスキップされます）');
        return;
      }
      // 本文中のカンマを全角カンマに置換してからカンマ区切りで出力（本文内の改行はそのまま残す）
      const csvLines = rows.map((s: string) => String(s).replace(/,/g, '，'));
      const csv = csvLines.join(',');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const pad = (n: number) => String(n).padStart(2, '0');
      const d = new Date();
      const ts = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
      a.href = url;
      a.download = `x_scheduled_posts_export_${ts}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('CSV export failed', e);
      alert('CSV出力に失敗しました: ' + String(e));
    }
  };

  // X 予約投稿を即時投稿する
  const handleManualPostX = async (post: any) => {
    console.log('[handleManualPostX] post object:', post);
    console.log('[handleManualPostX] scheduledPostId:', post.scheduledPostId);
    
    if (!post.scheduledPostId) {
      alert('投稿IDが見つかりません');
      return;
    }
    
    // Warn if content is empty
    if (!post.content || String(post.content).trim() === '') {
      if (!window.confirm("⚠️ 本文がまだ生成されていません。\n空のテキストで投稿しますか？")) return;
    } else if (!window.confirm("即時投稿を実行しますか？")) {
      return;
    }

    setPostingXId(post.scheduledPostId);
    try {
      const payload = { 
        scheduledPostId: post.scheduledPostId,
        sk: post.sk,  // Include full SK for correct DB lookup
        accountId: post.accountId,
        content: post.content,
        text: post.content  // also send as text for compatibility
      };
      console.log('[handleManualPostX] sending payload:', payload);
      
      const resp = await fetch('/api/x/tweet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));

      if (!resp.ok || !data?.ok) {
        alert(`即時投稿に失敗しました: ${data?.error || resp.statusText}`);
        return;
      }

      // UI を更新（投稿済みに変更）
      setScheduledPostsX(prev =>
        prev.map(p =>
          p.scheduledPostId === post.scheduledPostId
            ? { 
                ...p, 
                postedAt: data.post?.postedAt || Math.floor(Date.now() / 1000), 
                postId: data.post?.postId,
                status: data.post?.status || 'posted'
              }
            : p
        )
      );

      alert(`✅ 即時投稿に成功しました\n投稿ID: ${data.post?.postId || '—'}`);
    } catch (e: any) {
      alert(`即時投稿に失敗しました: ${e.message}`);
    } finally {
      setPostingXId('');
    }
  };

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
      // Only include X accounts that are enabled for auto-posting and match poolType
      const filteredAccountIds = new Set(xaccounts.filter((a: any) => (a.type || 'general') === poolType && a.autoPostEnabled === true).map(a => a.accountId));
      const posts = (xposts as any[]).filter((p: any) => filteredAccountIds.has(p.accountId));
      // ensure accountName present
      const postsWithNames = posts.map((p: any) => {
        const acc = xaccounts.find(a => a.accountId === p.accountId);
        return { ...p, accountName: acc ? (acc.displayName || acc.username || acc.accountName || '') : (p.accountName || ''), accountObj: acc || null };
      });
      // only include accounts matching current poolType and enabled for auto-posting in account filter
      const filteredAccounts = xaccounts.filter((a: any) => (a.type || 'general') === poolType && a.autoPostEnabled === true);
      setXAccountsList(filteredAccounts);
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
      // sort by createdAt desc (newest first)
      const iv = j.items || [];
      iv.sort((a: any, b: any) => (Number(b.createdAt || 0) - Number(a.createdAt || 0)));
      setItems(iv);
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
      // Exclude accounts with autoPostEnabled === false from counts and posting-capable calculations
      const enabledList = xlist.filter((a: any) => a.autoPostEnabled === true);
      const general = enabledList.filter((a: any) => (a.type || "general") === "general").length;
      const ero = enabledList.filter((a: any) => (a.type || "general") === "ero").length;
      const ero1 = enabledList.filter((a: any) => (a.type || "general") === "ero1").length;
      const ero2 = enabledList.filter((a: any) => (a.type || "general") === "ero2").length;
      const saikyou = enabledList.filter((a: any) => (a.type || "general") === "saikyou").length;
      setGeneralCount(general);
      setEroCount(ero);
      setEro1Count(ero1);
      setEro2Count(ero2);
      setSaikyouCount(saikyou);
      // xAccountsCount: number of accounts eligible for posting (autoPostEnabled)
      setXAccountsCount(enabledList.length);
      const filteredCount = enabledList.filter((a: any) => (a.type || "general") === poolType).length;
      setAccountsCount(filteredCount);
    } catch (e) {
      setAccountsCount(0);
      setGeneralCount(0);
      setEroCount(0);
      setXAccountsCount(0);
    }
  };

  const handleMediaSelect = (ev: React.ChangeEvent<HTMLInputElement>) => {
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
      let mediaUrls: string[] = [];

      // Upload images if any were selected
      if (images.length > 0) {
        const fileDataPromises = images.map(
          (file) =>
            new Promise<{ data: string; type: string; name: string }>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                resolve({
                  data: String(reader.result),
                  type: file.type,
                  name: file.name,
                });
              };
              reader.onerror = () => reject(new Error("failed_to_read_file"));
              reader.readAsDataURL(file);
            })
        );

        const fileData = await Promise.all(fileDataPromises);

        const uploadResp = await fetch("/api/post-pool/upload-media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ files: fileData }),
        });

        const uploadJson = await uploadResp.json().catch(() => ({}));
        if (!uploadResp.ok || !uploadJson.ok) {
          throw new Error(uploadJson.error || "media_upload_failed");
        }
        mediaUrls = uploadJson.urls || [];
        console.log(`[post-pool] uploaded ${mediaUrls.length} media files`);
      }

      // Save to pool with media URLs
      const resp = await fetch("/api/post-pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          type: poolType,
          content: content.trim(),
          images: mediaUrls,
        }),
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
  const relevantAccountCount = (() => {
    if (poolType === "general") return generalCount;
    if (poolType === "ero") return eroCount;
    if (poolType === "ero1") return ero1Count;
    if (poolType === "ero2") return ero2Count;
    return saikyouCount;
  })();
  const activeBuckets = (morningOn ? 1 : 0) + (noonOn ? 1 : 0) + (nightOn ? 1 : 0);
  const postsPerDayPerAcc = relevantAccountCount * activeBuckets;
  const daysCover = postsPerDayPerAcc > 0 ? Math.floor(poolCount / postsPerDayPerAcc) : null;
  const possibleDate = daysCover === null ? "計算不可" : new Date(Date.now() + (daysCover * 24 * 3600 * 1000)).toLocaleDateString();

  return (
    <div className="max-w-6xl mx-auto mt-8 p-4">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="text-sm text-gray-600 dark:text-gray-300">
            プール件数: <strong>{poolCount}</strong> ・ アカウント数: <strong>{accountsCount}</strong>
          </div>
          {/* 表示は該当種別のみ（投稿可能期日計算用） */}
          <div className="text-sm text-gray-600 dark:text-gray-300">投稿可能期日: <strong>{possibleDate}</strong>（保有日数: {daysCover === null ? "－" : `${daysCover}日`})</div>
        </div>
        <div className="flex items-center gap-6">
          {/* 朝 */}
          <div className="flex flex-col items-center">
            <div className="text-sm text-gray-600 dark:text-gray-300 mb-1">朝</div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={morningOn}
                disabled={settingLoading}
                onChange={async () => {
                  try {
                    setSettingLoading(true);
                    const newVal = !morningOn;
                    const resp = await fetch('/api/user-type-time-settings', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: poolType, morning: newVal }) });
                    if (!resp.ok) throw new Error('failed');
                    setMorningOn(newVal);
                  } catch (e) {
                    alert('設定の保存に失敗しました');
                  } finally { setSettingLoading(false); }
                }}
              />
              <div className={`w-12 h-6 bg-gray-200 rounded-full peer-checked:bg-blue-500 transition-colors`}></div>
              <span className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-6"></span>
            </label>
          </div>
          {/* 昼 */}
          <div className="flex flex-col items-center">
            <div className="text-sm text-gray-600 dark:text-gray-300 mb-1">昼</div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={noonOn}
                disabled={settingLoading}
                onChange={async () => {
                  try {
                    setSettingLoading(true);
                    const newVal = !noonOn;
                    const resp = await fetch('/api/user-type-time-settings', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: poolType, noon: newVal }) });
                    if (!resp.ok) throw new Error('failed');
                    setNoonOn(newVal);
                  } catch (e) {
                    alert('設定の保存に失敗しました');
                  } finally { setSettingLoading(false); }
                }}
              />
              <div className={`w-12 h-6 bg-gray-200 rounded-full peer-checked:bg-blue-500 transition-colors`}></div>
              <span className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-6"></span>
            </label>
          </div>
          {/* 晩 */}
          <div className="flex flex-col items-center">
            <div className="text-sm text-gray-600 dark:text-gray-300 mb-1">晩</div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={nightOn}
                disabled={settingLoading}
                onChange={async () => {
                  try {
                    setSettingLoading(true);
                    const newVal = !nightOn;
                    const resp = await fetch('/api/user-type-time-settings', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: poolType, night: newVal }) });
                    if (!resp.ok) throw new Error('failed');
                    setNightOn(newVal);
                  } catch (e) {
                    alert('設定の保存に失敗しました');
                  } finally { setSettingLoading(false); }
                }}
              />
              <div className={`w-12 h-6 bg-gray-200 rounded-full peer-checked:bg-blue-500 transition-colors`}></div>
              <span className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-6"></span>
            </label>
          </div>
          {/* プール再利用 */}
          <div className="flex flex-col items-center">
            <div className="text-sm text-gray-600 dark:text-gray-300 mb-1">プール再利用</div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={reuseOn}
                disabled={settingLoading}
                onChange={async () => {
                  try {
                    setSettingLoading(true);
                    const newVal = !reuseOn;
                    const resp = await fetch('/api/user-type-time-settings', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: poolType, reuse: newVal }) });
                    if (!resp.ok) throw new Error('failed');
                    setReuseOn(newVal);
                  } catch (e) {
                    alert('設定の保存に失敗しました');
                  } finally { setSettingLoading(false); }
                }}
              />
              <div className={`w-12 h-6 bg-gray-200 rounded-full peer-checked:bg-blue-500 transition-colors`}></div>
              <span className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-6"></span>
            </label>
          </div>
        </div>
      </div>

      <div className="mb-4">
        <textarea className="w-full border rounded p-2 min-h-[300px] bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" value={content} onChange={(e) => setContent(e.target.value)} placeholder="投稿本文を入力（改行可）"></textarea>
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-2">
            <input 
              type="file" 
              accept="image/*,video/*" 
              multiple 
              onChange={handleMediaSelect} 
              id="media-input"
              className="hidden" 
            />
            {images.length > 0 && (
              <span className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                {images.length}個選択
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className={`text-sm ${String(content || "").length > 140 ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-300'}`}>文字数: {String(content || "").length}</div>
            <button className="bg-green-500 dark:bg-green-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-green-600 dark:hover:bg-green-700 transition-colors disabled:opacity-60" onClick={handleSave} disabled={loading}>{loading ? "登録中..." : "登録"}</button>
          </div>
        </div>

        {/* Media preview (images and videos) */}
        {images.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {images.map((file, idx) => {
              const isVideo = file.type.startsWith("video/");
              return (
                <div key={idx} className="relative group">
                  {isVideo ? (
                    <video
                      src={URL.createObjectURL(file)}
                      className="w-full h-24 object-cover rounded border border-gray-300 dark:border-gray-600 bg-black"
                    />
                  ) : (
                    <img
                      src={URL.createObjectURL(file)}
                      alt={`preview ${idx}`}
                      className="w-full h-24 object-cover rounded border border-gray-300 dark:border-gray-600"
                    />
                  )}
                  <button
                    onClick={() => setImages((prev) => prev.filter((_, i) => i !== idx))}
                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs font-bold"
                    type="button"
                  >
                    ×
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 rounded-b text-center truncate">
                    {isVideo ? "🎬 " : "🖼️ "}{file.name}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Drag and drop zone - clickable */}
        <div
          onClick={() => document.getElementById('media-input')?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.classList.add("bg-blue-50", "dark:bg-blue-900/20", "border-blue-400");
          }}
          onDragLeave={(e) => {
            e.currentTarget.classList.remove("bg-blue-50", "dark:bg-blue-900/20", "border-blue-400");
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove("bg-blue-50", "dark:bg-blue-900/20", "border-blue-400");
            const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
            // Support both images and videos
            const mediaFiles = files.filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
            if (mediaFiles.length > 0) {
              const combined = [...images, ...mediaFiles].slice(0, 4);
              setImages(combined);
            }
          }}
          className="mt-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded p-4 text-center transition-colors cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50"
        >
          <p className="text-sm text-gray-500 dark:text-gray-400">
            画像・動画をドラッグ&ドロップするか、ここをクリック（最大4個）
          </p>
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
            <button className="bg-blue-500 dark:bg-blue-600 text-white rounded px-3 py-1 text-sm" onClick={loadPool}>再読み込み</button>
            <button className="bg-green-500 dark:bg-green-600 text-white rounded px-3 py-1 text-sm" onClick={() => setOpenImport(true)}>CSV取込</button>
            <ImportModal open={openImport} onClose={() => setOpenImport(false)} onImport={async (arr) => {
              // 登録処理：既存の /api/post-pool に逐次（バッチ）でPOSTし、重複はスキップして結果を集計する
              if (!Array.isArray(arr) || arr.length === 0) return;
              setLoading(true);
              try {
                // 既存プールの本文をセット化（トリムして比較）
                const existingSet = new Set<string>(items.map(it => String(it.content || '').trim()));
                let success = 0;
                let failed = 0;
                let skipped = 0;
                const batchSize = 5;
                for (let i = 0; i < arr.length; i += batchSize) {
                  const batch = arr.slice(i, i + batchSize);
                  await Promise.all(batch.map(async (text) => {
                    try {
                      const trimmed = String(text || '').trim();
                      if (trimmed === "") {
                        // 空はスキップ
                        skipped++;
                        return;
                      }
                      // 既に存在する本文はスキップ
                      if (existingSet.has(trimmed)) {
                        skipped++;
                        return;
                      }
                      // 登録実行
                      const resp = await fetch('/api/post-pool', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ type: poolType, content: trimmed, images: [] }),
                      });
                      const j = await resp.json().catch(() => ({}));
                      if (resp.ok && j.ok) {
                        success++;
                        // 登録成功した本文を既存セットに追加して同バッチ内の重複も防止
                        existingSet.add(trimmed);
                      } else {
                        failed++;
                      }
                    } catch (e) {
                      console.error('import item failed', e);
                      failed++;
                    }
                  }));
                }
                await loadPool();
                alert(`取り込み完了：成功 ${success} 件、失敗 ${failed} 件、スキップ ${skipped} 件`);
              } finally {
                setLoading(false);
              }
            }} maxLen={140} />
          </div>
          {loading ? <div>読み込み中...</div> : (
            <table className="w-full border border-gray-200 dark:border-gray-700">
              <thead className="bg-gray-100 dark:bg-gray-800">
                <tr>
                  <th className="p-2 text-left">本文</th>
                  <th className="p-2 text-center" style={{ width: 100 }}>画像</th>
                  <th className="p-2 text-right" style={{ width: 140 }}>作成日</th>
                  <th className="p-2 text-center" style={{ width: 100 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.poolId} className="border-t dark:border-gray-700">
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
                    <td className="px-2 py-1 text-center">
                      {(it.images && it.images.length > 0) ? (
                        <div className="flex items-center justify-center gap-1">
                          <span className="text-sm font-medium text-blue-600 dark:text-blue-400">{it.images.length}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">個</span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400 dark:text-gray-500">なし</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right text-sm text-gray-600 dark:text-gray-300">{it.createdAt ? new Date(it.createdAt * 1000).toLocaleString() : ""}</td>
                    <td className="px-2 py-1 text-center">
                      <button className="bg-red-500 dark:bg-red-600 text-white px-2 py-1 rounded hover:bg-red-600 dark:hover:bg-red-700 transition-colors text-sm" onClick={() => handleDelete(it.poolId)}>削除</button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-gray-500 dark:text-gray-400">データがありません</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-2 cursor-pointer" onClick={() => { setOpenScheduled((s) => !s); if (!openScheduled) loadScheduledX(); }}>予約投稿一覧 {openScheduled ? "▲" : "▼"}</h2>
        {openScheduled && (
          <div>
            <div className="mb-4 flex justify-between gap-2 items-center">
              <div className="flex items-center gap-3">
                <label className="text-sm">状態:</label>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border rounded px-2 py-1">
                  <option value="">すべて</option>
                  <option value="scheduled">未投稿</option>
                  <option value="posted">投稿済</option>
                </select>
                <label className="text-sm">アカウント:</label>
                <select value={filterAccount} onChange={e => setFilterAccount(e.target.value)} className="border rounded px-2 py-1">
                  <option value="">すべて</option>
                  {xAccountsList.map((a:any) => <option key={a.accountId} value={a.accountId}>{a.displayName || a.username || a.accountId}</option>)}
                </select>
              </div>
                <div className="flex items-center gap-2">
                <button
                  className="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded px-3 py-1 text-sm hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors disabled:opacity-60"
                  onClick={async () => {
                    if (!confirm("現在の設定でOFFの時間帯の予約を削除し、当日の未来枠で欠損している予約を生成します。実行しますか？")) return;
                    try {
                      setRegenLoading(true);
                      const resp = await fetch('/api/post-pool/regenerate-scheduled', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: poolType }) });
                      const j = await resp.json().catch(() => ({}));
                      if (!resp.ok || !j?.ok) {
                        if (j?.error === 'rate_limited') {
                          const sec = Number(j?.retry_after || 60);
                          const msg = sec >= 60 ? `${Math.ceil(sec / 60)}分後に再度実行してください` : `${sec}秒後に再度実行してください`;
                          alert(msg);
                        } else {
                          alert('再生成に失敗しました: ' + (j?.error || JSON.stringify(j)));
                        }
                      } else {
                        alert(`再生成完了: 作成 ${j.created || 0} / 削除 ${j.deleted || 0}`);
                        await loadScheduledX();
                      }
                    } catch (e) {
                      alert('再生成に失敗しました: ' + String(e));
                    } finally {
                      setRegenLoading(false);
                    }
                  }}
                  disabled={regenLoading}
                >
                  {regenLoading ? '再生成中...' : '空予約再生成'}
                </button>
                <label className="text-sm">ソート:</label>
                <select value={sortKey} onChange={e => setSortKey(e.target.value as any)} className="border rounded px-2 py-1">
                  <option value="scheduledAt">予約日時</option>
                  <option value="postedAt">投稿日時</option>
                </select>
                <button className="px-2 py-1 border rounded" onClick={() => setSortAsc(s => !s)}>{sortAsc ? '昇順' : '降順'}</button>
                <button className="px-2 py-1 border rounded" onClick={exportScheduledCsv}>CSV出力</button>
                <button className="bg-blue-500 dark:bg-blue-600 text-white rounded px-3 py-1 text-sm" onClick={loadScheduledX}>再読み込み</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full bg-white dark:bg-transparent border border-gray-200 dark:border-gray-700">
                <thead className="bg-gray-100 dark:bg-gray-800">
                  <tr>
                    <th className="border p-2" style={{ width: 260 }}>アカウント</th>
                    <th className="border p-2" style={{ width: 180 }}>予約投稿日時</th>
                    <th className="border p-2" style={{ width: 520 }}>本文テキスト</th>
                    <th className="border p-2" style={{ width: 160 }}>投稿日時</th>
                    <th className="border p-2" style={{ width: 160 }}>投稿ID</th>
                    <th className="border p-2" style={{ width: 120 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduledPostsX
                    .filter((p:any) => (filterStatus ? (filterStatus === 'posted' ? !!p.postedAt : !p.postedAt) : true))
                    .filter((p:any) => (filterAccount ? p.accountId === filterAccount : true))
                    .sort((a:any,b:any) => {
                      const ka = sortKey === 'scheduledAt' ? (a.scheduledAt||0) : (a.postedAt||0);
                      const kb = sortKey === 'scheduledAt' ? (b.scheduledAt||0) : (b.postedAt||0);
                      return sortAsc ? ka - kb : kb - ka;
                    })
                    .map((p:any) => (
                    <tr key={p.scheduledPostId} className="border-t dark:border-gray-700">
                      <td className="px-2 py-1">
                        <div className="text-sm font-medium" style={{ lineHeight: '1rem', maxHeight: '3rem', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }} title={p.content || ''}>{p.accountName}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{p.accountId}</div>
                      </td>
                      <td className="px-2 py-1">
                        {p.scheduledAt ? (
                          typeof p.scheduledAt === 'number' ? (
                            (() => {
                              const d = new Date(p.scheduledAt * 1000);
                              const datePart = d.toLocaleDateString();
                              const timePart = d.toLocaleTimeString();
                              return (
                                <div style={{ whiteSpace: 'pre-line' }}>
                                  {datePart}
                                  {'\n'}
                                  {timePart}
                                </div>
                              );
                            })()
                          ) : (
                            (() => {
                              const s = String(p.scheduledAt || "");
                              const replaced = s.includes('\n') ? s : s.replace(/\s+/, '\n');
                              return <div style={{ whiteSpace: 'pre-line' }}>{replaced}</div>;
                            })()
                          )
                        ) : (
                          ''
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <div className="text-sm" style={{ whiteSpace: 'pre-line', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', height: '3rem', minHeight: '3rem', lineHeight: '1rem' }} title={p.content || ''}>
                          {p.content}
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        {p.postedAt ? (
                          typeof p.postedAt === 'number' ? (
                            (() => {
                              const d = new Date(p.postedAt * 1000);
                              const datePart = d.toLocaleDateString();
                              const timePart = d.toLocaleTimeString();
                              return (
                                <div style={{ whiteSpace: 'pre-line' }}>
                                  {datePart}
                                  {'\n'}
                                  {timePart}
                                </div>
                              );
                            })()
                          ) : (
                            (() => {
                              const s = String(p.postedAt || "");
                              const replaced = s.includes('\n') ? s : s.replace(/\s+/, '\n');
                              return <div style={{ whiteSpace: 'pre-line' }}>{replaced}</div>;
                            })()
                          )
                        ) : (
                          ''
                        )}
                      </td>
                      <td className="px-2 py-1">
                      {p.status === 'posted' && p.postId ? (
                          // Xの投稿一覧なので X のパーマリンクを生成する
                          <a href={`https://x.com/${encodeURIComponent(p.accountId)}/status/${encodeURIComponent(p.postId)}`} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline">{String(p.postId).slice(0,30)}</a>
                        ) : ''}
                      </td>
                      <td className="px-2 py-1">
                        {!p.postedAt && (
                          <button
                            className={`text-white px-2 py-1 rounded text-xs ${
                              postingXId === p.scheduledPostId
                                ? 'bg-green-300 cursor-not-allowed'
                                : 'bg-green-500 hover:bg-green-600'
                            }`}
                            onClick={() => handleManualPostX(p)}
                            disabled={postingXId === p.scheduledPostId}
                          >
                            {postingXId === p.scheduledPostId ? '実行中…' : '即時投稿'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {scheduledPostsX.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-gray-500 dark:text-gray-400">データがありません</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


