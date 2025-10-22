// /src/app/scheduled-posts/ScheduledPostsTable.tsx
// [MOD] 投稿IDセル：投稿済みのときのみクリックで別タブ（postUrlがあればアンカー表示）
"use client";

import React, { useEffect, useState } from "react";
import LoadingOverlay from "@/components/LoadingOverlay";
import ScheduledPostEditorModal, {
  ScheduledPostType,
} from "./ScheduledPostEditorModal";

// 既存定義は維持
type ScheduledPostStatus = "" | "scheduled" | "posted" | "expired" | "deleted";
type ReplyType = { id: string; replyContent: string; status: "replied" | "unreplied" };

const statusOptions = [
  { value: "", label: "すべて" },
  { value: "scheduled", label: "未投稿" },
  { value: "posted", label: "投稿済み" },
  { value: "expired", label: "期限切れ" },
  { value: "deleted", label: "削除済" },
];

const typeOptions = [
  { value: "", label: "すべて" },
  { value: "quote", label: "引用投稿" },
  { value: "normal", label: "通常投稿" },
];

export default function ScheduledPostsTable() {
  const [posts, setPosts] = useState<ScheduledPostType[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [sortKey, setSortKey] = useState<"scheduledAt" | "status">("scheduledAt");
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [filterStatus, setFilterStatus] = useState<ScheduledPostStatus>("");
  const [filterType, setFilterType] = useState<string>("");
  const [accountFilter, setAccountFilter] = useState<string>("");
  const [accountIds, setAccountIds] = useState<string[]>([]);
  // アカウントが削除中であることを示すマップ
  const [accountsDeletingMap, setAccountsDeletingMap] = useState<Record<string, boolean>>({});

  // [MOD] 新モーダルの管理
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"add" | "edit">("add");
  const [editorInitial, setEditorInitial] = useState<ScheduledPostType | null>(null);

  const [repliesModalOpen, setRepliesModalOpen] = useState(false);
  const [repliesModalTarget, setRepliesModalTarget] = useState<string>("");
  const [repliesModalItems, setRepliesModalItems] = useState<ReplyType[]>([]);
  // [ADD] bulk selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // (removed) app-open column and per-account app toggles
  // Feature gate: hide delete-related controls until server-side implementation is ready
  const [showDeleteControls] = useState<boolean>(false);
  // keep a local showAppColumn state to respond to settings events (no UI column in this view)
  const [showAppColumn, setShowAppColumn] = useState<boolean>(false);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const selectAllVisible = () => {
    const visibleIds = sortedPosts.map(p => p.scheduledPostId);
    setSelectedIds(visibleIds);
  };

  const clearSelection = () => setSelectedIds([]);

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return alert("選択がありません");
    if (!confirm(`選択した ${selectedIds.length} 件を削除しますか？`)) return;
    setBulkDeleting(true);
    try {
      // Execute same patch flow as single delete per item to keep behavior identical
      const results: { id: string; ok: boolean; deleted: boolean }[] = [];
      for (const id of selectedIds) {
        try {
          const resp = await fetch(`/api/scheduled-posts`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ scheduledPostId: id, isDeleted: true }),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || !data?.ok) {
            results.push({ id, ok: false, deleted: false });
          } else {
            results.push({ id, ok: true, deleted: !!data.deleted });
          }
        } catch (e) {
          results.push({ id, ok: false, deleted: false });
        }
      }

      // Apply results client-side using same rules as handleDelete
      setPosts(prev => prev.flatMap(p => {
        if (!selectedIds.includes(p.scheduledPostId)) return [p];
        const r = results.find(x => x.id === p.scheduledPostId);
        if (!r || !r.ok) return [p]; // leave unchanged on failure
        // If server reported deleted=true and post was not posted, remove from list
        if (r.deleted && !(p.status === "posted")) return [] as any;
        // Otherwise mark isDeleted
        return [{ ...p, isDeleted: true }];
      }));

      clearSelection();
    } catch (e: any) {
      alert(`一括削除に失敗しました: ${e.message || String(e)}`);
    } finally {
      setBulkDeleting(false);
    }
  };

  // [ADD] 即時投稿の実行中フラグ（多重押し防止）
  const [postingId, setPostingId] = useState<string>("");
  // Loading overlay for immediate actions
  const [loadingOverlayOpen, setLoadingOverlayOpen] = useState<boolean>(false);
  
  // [ADD] 即時二段階投稿の実行中フラグ（多重押し防止）
  const [secondStagePostingId, setSecondStagePostingId] = useState<string>("");
  
  // [ADD] デバッグ関連のstate
  const [debugModalOpen, setDebugModalOpen] = useState<boolean>(false);
  const [debugData, setDebugData] = useState<any>(null);
  const [bulkDeleting, setBulkDeleting] = useState<boolean>(false);
  const [creatingToday, setCreatingToday] = useState<boolean>(false);
  const [selectAccountsModalOpen, setSelectAccountsModalOpen] = useState<boolean>(false);
  const [selectedAccountsForCreate, setSelectedAccountsForCreate] = useState<string[]>([]);

  // 一覧取得（既存API）
  const loadPosts = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/scheduled-posts`, { credentials: "include" });
      const data = await res.json();
      setPosts(data.posts ?? []);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPosts();
    // リモート設定が変わったら一覧を再読み込み
    const handler = (e: any) => {
      loadPosts();
    };
    window.addEventListener("userSettingsUpdated", handler as EventListener);
    return () => window.removeEventListener("userSettingsUpdated", handler as EventListener);
  }, []);

  // アカウント一覧を取得してフィルタ用に保持
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/threads-accounts', { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        const list = (data.accounts || data.items || []) as any[];
        const ids = Array.from(new Set(list.map(a => a.accountId).filter(Boolean)));
        setAccountIds(ids);
        // 削除中ステータスを map にして保持
        const m: Record<string, boolean> = {};
        for (const it of list) {
          if (it && it.accountId) {
            m[it.accountId] = (it.status === 'deleting');
          }
        }
        setAccountsDeletingMap(m);
      } catch (e) {
        // ignore
      }
    })();
  }, []);

  // [MOD] 追加

  const openAdd = () => {
    setEditorMode("add");
    setEditorInitial(null);
    setEditorOpen(true);
  };

  // [FIX] 追加保存：レスポンスの data.post を使って反映
  const handleAddSave = async (newPost: ScheduledPostType) => {
    const resp = await fetch(`/api/scheduled-posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(newPost),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.ok) {
      alert(`保存に失敗しました: ${data?.error || resp.statusText}`);
      return;
    }
    setPosts((prev) => [...prev, data.post]); // [FIX]
  };

  // [MOD] 編集
  const openEdit = (id: string) => {
    const p = posts.find((x) => x.scheduledPostId === id) || null;
    if (!p) return;
    setEditorMode("edit");
    setEditorInitial(p);
    setEditorOpen(true);
  };

  // [MOD] 編集保存（既存PATCH）
  const handleEditSave = async (edited: ScheduledPostType) => {
    // Send full editable fields so server saves secondStageWanted/deleteScheduledAt/deleteParentAfter
    const payload: any = {
      scheduledPostId: edited.scheduledPostId,
      content: edited.content,
      scheduledAt: edited.scheduledAt,
      // include timeRange so edits to the time range are persisted
      timeRange: (edited as any).timeRange,
    };
    if (typeof (edited as any).secondStageWanted !== 'undefined') payload.secondStageWanted = !!(edited as any).secondStageWanted;
    if (typeof (edited as any).deleteScheduledAt !== 'undefined') payload.deleteScheduledAt = (edited as any).deleteScheduledAt;
    if (typeof (edited as any).deleteParentAfter !== 'undefined') payload.deleteParentAfter = !!(edited as any).deleteParentAfter;

    const resp = await fetch(`/api/scheduled-posts`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.ok) {
      alert(`更新に失敗しました: ${data?.error || resp.statusText}`);
      return;
    }

    // Prefer authoritative server response if available
    const updated = data.post || edited;
    setPosts((prev) => prev.map((p) => (p.scheduledPostId === edited.scheduledPostId ? { ...p, ...updated } : p)));
  };

  // 削除（新）: 未投稿は物理削除、投稿済は実投稿削除 + 論理削除
  const handleDelete = async (id: string) => {
    // Double confirmation (不可逆確認 → 最終確認)
    if (!window.confirm("この操作は取り消せません。投稿を完全に削除します。続行しますか？")) return;
    if (!window.confirm("最終確認：本当にこの投稿を削除しますか？")) return;

    // debug output removed

    const post = posts.find(p => p.scheduledPostId === id);
    if (!post) {
      // console.error('[UI][delete] post not found', { scheduledPostId: id });
      return alert("投稿が見つかりませんでした");
    }
    const numeric = (post as any).numericPostId;
    // debug output removed
    if (!numeric) {
      // console.warn('[UI][delete] numericPostId missing', { scheduledPostId: id });
      return alert("numericPostId が存在しないため削除できません");
    }

    // set deleting state
    setBulkDeleting(true);
    try {
      const payload = { scheduledPostId: id, numericPostId: String(numeric), accountId: post.accountId };
      // debug output removed
      const resp = await fetch('/api/threads/delete-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || !j?.ok) {
        // console.error('[UI][delete] api reported error', { status: resp.status, body: j });
        throw new Error(j?.error || '削除に失敗しました');
      }

      // physical delete: remove from UI if server deleted
      if (j.deletedCount && j.deletedCount > 0) {
        // console.info('[UI][delete] deleted scheduled post', { scheduledPostId: id, deletedCount: j.deletedCount });
        setPosts(prev => prev.filter(p => p.scheduledPostId !== id));
      } else {
        // console.info('[UI][delete] marked isDeleted', { scheduledPostId: id });
        setPosts(prev => prev.map(p => p.scheduledPostId === id ? { ...p, isDeleted: true } : p));
      }

      alert(`削除完了: 削除数=${j.deletedCount || 0} 残=${j.remaining || 0}`);
    } catch (e: any) {
      // console.error('[UI][delete] failed', e);
      alert(`削除に失敗しました: ${e.message || String(e)}`);
    } finally {
      setBulkDeleting(false);
    }
  };

  // リプモーダル（既存UIのまま）
  const openReplies = (replies: ReplyType[], postId: string) => {
    setRepliesModalItems(replies || []);
    setRepliesModalTarget(postId);
    setRepliesModalOpen(true);
  };

  // [ADD] 即時二段階投稿の実行関数
  const handleSecondStage = async (scheduledPostId: string) => {
    if (secondStagePostingId) return; // 多重実行防止
    
    if (!window.confirm("二段階投稿を実行しますか？")) return;
    
    setSecondStagePostingId(scheduledPostId);
    try {
      const res = await fetch("/api/scheduled-posts/second-stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ scheduledPostId }),
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      
      // 成功時はUIを更新
      setPosts(posts =>
        posts.map(p =>
          p.scheduledPostId === scheduledPostId
            ? { 
                ...p, 
                doublePostStatus: "done",
                secondStagePostId: data.secondStagePostId,
                secondStageAt: Math.floor(Date.now() / 1000)
              }
            : p
        )
      );
      
      alert(`✅ 二段階投稿が完了しました！\n投稿ID: ${data.secondStagePostId}`);
      
    } catch (e: any) {
      // console.error("Second stage posting error:", e);
      alert(`❌ 二段階投稿に失敗しました: ${e.message}`);
    } finally {
      setSecondStagePostingId("");
    }
  };

  // [ADD] デバッグ詳細情報を取得する関数
  const handleDebugDetails = async (scheduledPostId: string) => {
    try {
      const res = await fetch("/api/debug/second-stage-detail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ scheduledPostId }),
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      
      setDebugData(data);
      setDebugModalOpen(true);
      
    } catch (e: any) {
      // console.error("Debug details error:", e);
      alert(`デバッグ情報の取得に失敗しました: ${e.message}`);
    }
  };

  // 当日の自動投稿を一括作成する
  const handleCreateTodayAutoPosts = async () => {
    // ダイアログでアカウント選択を開く
    setSelectAccountsModalOpen(true);
  };

  const executeCreateForSelectedAccounts = async () => {
    if (selectedAccountsForCreate.length === 0) return alert('アカウントを選択してください');
    setSelectAccountsModalOpen(false);
    setCreatingToday(true);
    try {
      const res = await fetch('/api/auto-posts/create-today', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountIds: selectedAccountsForCreate }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
      alert(`作成完了: ${data.created || 0} 件`);
      await loadPosts();
    } catch (e: any) {
      alert(`作成に失敗しました: ${e.message || String(e)}`);
    } finally {
      setCreatingToday(false);
      setSelectedAccountsForCreate([]);
    }
  };



  const sortedPosts = posts
    .filter((post) => {
      // アカウントフィルタ
      if (accountFilter && post.accountId !== accountFilter) return false;
      // type フィルタが指定されている場合は type も評価（status フィルタに関わらず適用）
      if (filterType === 'quote' && (post as any).type !== 'quote') return false;
      if (filterType === 'normal' && (post as any).type === 'quote') return false;
      // デフォルト（filterStatusが空）は論理削除されたものを除外
      if (!filterStatus) return !post.isDeleted;
      // 削除済フィルタが選択された場合は isDeleted=true のみ表示
      if (filterStatus === "deleted") return !!post.isDeleted;
      // それ以外のステータスフィルタは isDeleted=false のものを対象にする
      return (post.status || "scheduled") === filterStatus && !post.isDeleted;
    })
    .sort((a, b) => {
      if (sortKey === "scheduledAt") {
        return sortAsc
          ? String(a.scheduledAt).localeCompare(String(b.scheduledAt))
          : String(b.scheduledAt).localeCompare(String(a.scheduledAt));
      }
      if (sortKey === "status") {
        return sortAsc
          ? (a.status || "").localeCompare(b.status || "")
          : (b.status || "").localeCompare(a.status || "");
      }
      return 0;
    });

  // [FIX] 即時投稿：実行中フラグのセット/解除と成功後の反映
  const handleManualRun = async (p: ScheduledPostType) => {
    if (!confirm("即時投稿を実行しますか？")) return;
    try {
      setPostingId(p.scheduledPostId); // [FIX] 実行中フラグON
      setLoadingOverlayOpen(true);
      const resp = await fetch("/api/scheduled-posts/manual-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ scheduledPostId: p.scheduledPostId }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.ok) {
        alert(`即時投稿に失敗しました: ${data?.error || resp.statusText}`);
        return;
      }
      // 成功したら postUrl / postId / postedAt / status / doublePostStatus を反映
      setPosts((prev) =>
        prev.map((x) =>
          x.scheduledPostId === p.scheduledPostId
            ? {
                ...x,
                status: "posted",
                postedAt: data.post.postedAt,
                postUrl: data.post.postUrl,
                postId: data.post.postId,
                doublePostStatus: data.post.doublePostStatus || undefined,
              }
            : x
        )
      );
    } finally {
      setPostingId(""); // [FIX] 実行中フラグOFF
      setLoadingOverlayOpen(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/user-settings', { credentials: 'include', cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          const s = j?.settings || j || {};
          setShowAppColumn(!!s.enableAppColumn);
        }
      } catch (_) {}
    })();
    const listener = (e: Event) => {
      const ce = e as CustomEvent<Record<string, unknown>>;
      setShowAppColumn(!!ce.detail?.enableAppColumn);
    };
    try { window.addEventListener('userSettingsUpdated', listener); } catch (_) {}
    return () => { try { window.removeEventListener('userSettingsUpdated', listener); } catch (_) {} };
  }, []);

  if (loading) return <div className="p-6 text-center">読み込み中...</div>;

  return (
    <div className="p-4">
      {/* [ADD] エディタモーダル */}
      {/* [FIX] 編集対象を渡す（属性列にはコメントを置かない） */}
      <ScheduledPostEditorModal
        open={editorOpen}
        mode={editorMode}
        initial={editorInitial}
        onClose={() => setEditorOpen(false)}
        onSave={editorMode === "add" ? handleAddSave : handleEditSave}
      />

      {bulkDeleting && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded p-4 shadow">
            <div className="text-center font-medium">一括削除実行中…</div>
          </div>
        </div>
      )}

      {/* 既存ボタン群 */}
      <div className="flex justify-between items-center mb-4" style={{ background: 'white', paddingTop: 8, paddingBottom: 8 }}>
        <h2 className="text-xl font-bold">予約投稿一覧</h2>
        <div className="flex gap-2">
          <button
            onClick={loadPosts}
            className="bg-blue-500 text-white rounded px-4 py-2 hover:bg-blue-600"
            disabled={loading}
          >
            {loading ? "読み込み中..." : "再読み込み"}
          </button>

          <button
            onClick={openAdd}
            className="bg-green-500 text-white rounded px-4 py-2 hover:bg-green-600"
          >
            ＋予約投稿追加
          </button>
          <button
            onClick={handleCreateTodayAutoPosts}
            className="bg-purple-500 text-white rounded px-4 py-2 hover:bg-purple-600"
          >
            当日自動作成
          </button>
          <button
            onClick={selectAllVisible}
            className="border rounded px-3 py-1"
          >
            全選択
          </button>
          <button
            onClick={clearSelection}
            className="border rounded px-3 py-1"
          >
            選択解除
          </button>
          <button
            onClick={handleBulkDelete}
            className="bg-red-500 text-white rounded px-3 py-1 hover:bg-red-600"
            disabled={bulkDeleting}
          >
            {bulkDeleting ? "削除中..." : "選択削除"}
          </button>
        </div>
      </div>

      {/* アカウント選択モーダル */}
      {selectAccountsModalOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSelectAccountsModalOpen(false)} />
          <div className="absolute left-1/2 top-1/2 w-[95vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">当日自動作成 - 対象アカウント選択</h3>
              <button className="rounded-md p-1 hover:bg-gray-100 dark:hover:bg-gray-800" onClick={() => setSelectAccountsModalOpen(false)} aria-label="close">✕</button>
            </div>
            <div className="mt-3 max-h-72 overflow-y-auto">
              <div className="grid grid-cols-2 gap-2">
                {accountIds.map(id => (
                  <label key={id} className="flex items-center gap-2 p-2 border rounded cursor-pointer">
                    <input type="checkbox" checked={selectedAccountsForCreate.includes(id)} onChange={(e) => {
                      setSelectedAccountsForCreate(prev => e.target.checked ? [...prev, id] : prev.filter(x => x !== id));
                    }} />
                    <span className="text-sm">{id}</span>
                  </label>
                ))}
                {accountIds.length === 0 && <div className="text-center text-gray-500 p-4">アカウントがありません</div>}
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="px-3 py-1 rounded bg-gray-200" onClick={() => setSelectAccountsModalOpen(false)}>キャンセル</button>
              <button className="px-3 py-1 rounded bg-purple-500 text-white" onClick={executeCreateForSelectedAccounts}>実行</button>
            </div>
          </div>
        </div>
      )}

      {/* 共通ロードオーバーレイ */}
      <LoadingOverlay open={creatingToday || bulkDeleting} message={creatingToday ? '当日自動投稿を作成中です…' : '処理中…'} />

      <div className="flex space-x-2 mb-2" style={{ paddingTop: 6, paddingBottom: 6 }}>
        <select
          className="border rounded p-1"
          value={filterStatus}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            setFilterStatus(e.target.value as ScheduledPostStatus)
          }
        >
          {statusOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          className="border rounded p-1"
          value={filterType}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterType(e.target.value)}
        >
          {typeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          className="border rounded p-1"
          value={accountFilter}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setAccountFilter(e.target.value)}
        >
          <option value="">全てのアカウント</option>
          {accountIds.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
        <button
          className="border rounded px-2 py-1"
          onClick={() => {
            setSortKey("scheduledAt");
            setSortAsc((prev) => !prev);
          }}
        >
          日時順ソート
        </button>
        <button
          className="border rounded px-2 py-1"
          onClick={() => {
            setSortKey("status");
            setSortAsc((prev) => !prev);
          }}
        >
          ステータス順ソート
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full bg-white dark:bg-gray-900 border">
          <thead className="dark:bg-gray-800">
            <tr>
              <th className="border p-1" style={{ width: 40 }}><input type="checkbox" checked={selectedIds.length === sortedPosts.length && sortedPosts.length > 0} onChange={(e) => e.target.checked ? selectAllVisible() : clearSelection()} /></th>
              <th className="border p-1" style={{ width: 180 }}>アカウント</th>
              <th className="border p-1" style={{ width: 160 }}>予約投稿日時</th>
              <th className="border p-1" style={{ width: 140 }}>自動投稿</th>
              <th className="border p-1" style={{ width: 200 }}>生成テーマ</th>
              <th className="border p-1" style={{ width: 140 }}>引用元投稿ID</th>
              <th className="border p-1" style={{ width: 360 }}>本文テキスト</th>
              <th className="border p-1" style={{ width: 160 }}>投稿日時</th>
              <th className="border p-1" style={{ width: 140 }}>投稿ID</th>
              <th className="border p-1" style={{ width: 140 }}>二段階投稿</th>
              {showDeleteControls && <th className="border p-1" style={{ width: 120 }}>二段階投稿削除</th>}
              {showDeleteControls && <th className="border p-1" style={{ width: 120 }}>投稿削除</th>}
              <th className="border p-1" style={{ width: 90 }}>リプ状況</th>
              
              <th className="border p-1" style={{ width: 180 }}>アクション</th>
            </tr>
          </thead>
          <tbody>
            {sortedPosts.map((post) => {
              const autoPostLabel = post.autoPostGroupId || "";
              const repliesNum = Number(post.replyCount ?? 0);
              // 新しいreplyStatusフィールドを使用
              const replyStatus = (post as any).replyStatus || { replied: 0, total: 0 };
              const repliesStatus = `${replyStatus.replied}/${replyStatus.total}`;
              const isPosting = postingId === post.scheduledPostId;

              // [FIX] 型エラー回避のため any キャストで postUrl を取得
              const pUrl = (post as any).postUrl as string | undefined;
              // Normalize pUrl: treat '-' or quoted '-' as missing so UI falls back to generatedUrl
              const normalizedPUrl = pUrl ? String(pUrl).trim().replace(/^'+|'+$/g, '') : '';
              const validPUrl = (normalizedPUrl && normalizedPUrl !== '-') ? normalizedPUrl : undefined;
              // fallback to account profile if no post permalink available
              const profileUrl = post.accountId ? `https://www.threads.com/@${post.accountId}` : undefined;
              // postIdからpostURLを生成
              const postId = (post as any).postId as string | undefined;
              const generatedUrl = postId ? `https://www.threads.net/post/${postId}` : undefined;

              const deleted = !!post.isDeleted;
              const accountIsDeleting = accountsDeletingMap[post.accountId] === true;
              // Failure indicators from backend: postAttempts, lastPostError, permanentFailure
              const failureCount = Number((post as any).postAttempts || 0);
              const lastError = (post as any).lastPostError || (post as any).lastPostErrorMessage || '';
              const permFailure = !!(post as any).permanentFailure;
              const hasFailure = failureCount > 0 || !!lastError || permFailure;
              const rowClass = deleted ? 'bg-gray-100 text-gray-500' : hasFailure ? 'bg-red-50' : '';
              const rowTitle = lastError ? `投稿失敗: ${String(lastError).slice(0,200)}` : undefined;
              return (
                <tr key={post.scheduledPostId} className={rowClass} title={rowTitle}>
                  <td className="border p-1" onClick={() => { if (!deleted) toggleSelect(post.scheduledPostId); }} style={{ cursor: deleted ? 'default' : 'pointer' }}>
                    {!deleted && (
                      <input type="checkbox" checked={selectedIds.includes(post.scheduledPostId)} onChange={(e) => { e.stopPropagation(); toggleSelect(post.scheduledPostId); }} />
                    )}
                  </td>
                  <td className="border p-1">
                    <div>
                      <div className="text-sm font-medium">{post.accountName}</div>
                      <div className="flex items-center gap-2">
                        <div className="text-xs text-gray-500 break-words">{post.accountId}</div>
                        {accountIsDeleting && <div className="inline-block bg-red-600 text-white text-[11px] px-2 py-0.5 rounded">削除中</div>}
                      </div>
                    </div>
                  </td>
                  <td className="border p-1 align-top">
                    {post.scheduledAt ? (
                      typeof post.scheduledAt === "number" ? (
                        (() => {
                          const d = new Date(post.scheduledAt * 1000);
                          // 日付と時間を分けて表示（改行を必ず入れる）
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
                        // 文字列の場合は日付と時間の間に改行を挿入する（既に改行があればそのまま）
                        (() => {
                          const s = String(post.scheduledAt || "");
                          // ISOや 'YYYY/MM/DD HH:MM:SS' 等を想定して、最初の空白を改行に置換
                          const replaced = s.includes('\n') ? s : s.replace(/\s+/, '\n');
                          return <div style={{ whiteSpace: 'pre-line' }}>{replaced}</div>;
                        })()
                      )
                    ) : (
                      <></>
                    )}
                  </td>
                  <td className="border p-1">{autoPostLabel}</td>
                  <td className="border p-1">
                    <div className="text-sm" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'normal', maxHeight: '3rem' }} title={post.theme}>{post.theme}</div>
                  </td>
                  <td className="border p-1">
                    {/* 引用元投稿ID列: sourcePostId があれば表示、クリックで該当投稿へ（投稿が存在する場合は外部URLへ） */}
                    {((post as any).sourcePostId || (post as any).sourcePostShortcode) ? (
                      (() => {
                        const src = (post as any).sourcePostShortcode || (post as any).sourcePostId;
                        // Only create URL if src looks like a non-empty string (shortcode). Otherwise show '-'
                        const isStringId = typeof src === 'string' && src.trim().length > 0;
                        if (!isStringId) return <span className="text-sm">-</span>;
                        const srcUrl = `https://www.threads.net/post/${src}`;
                        return (
                          <a href={srcUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline">{String(src)}</a>
                        );
                      })()
                    ) : (
                      "-"
                    )}
                  </td>
                  
                  <td className="border p-1" title={String(post.content || '')}>
                    <div className="text-sm" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'normal', maxHeight: '4.5rem' }}>
                      {post.content || ""}
                    </div>
                  </td>

                  <td className="border p-1">
                    {post.status === "posted" ? (
                      post.postedAt
                        ? typeof post.postedAt === "number"
                          ? new Date(post.postedAt * 1000).toLocaleString()
                          : (post.postedAt as any)
                        : ""
                    ) : deleted ? (
                      (post as any).deletedAt ? new Date((post as any).deletedAt * 1000).toLocaleString() : "削除予定"
                    ) : (
                      // 未投稿かつ自動投稿グループ使用時は timeRange を表示
                      <span className="text-xs text-gray-600">
                        {post.autoPostGroupId && post.autoPostGroupId.includes("自動投稿") && post.timeRange
                          ? post.timeRange
                          : ""}
                      </span>
                    )}
                  </td>
                  <td className="border p-1">
                    {/* 投稿ID列: postUrl があればアンカー、無ければ postId 表示、どちらも無ければ 空 */}
                    {post.status === "posted" ? (
                      (validPUrl || generatedUrl || profileUrl) ? (
                        <a href={validPUrl || generatedUrl || profileUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline">{String(post.postId || (post as any).numericPostId || '').slice(0, 30)}</a>
                      ) : (
                        <span className="text-sm">{post.postId || (post as any).numericPostId || ""}</span>
                      )
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="border p-1">
                    {/* 二段階投稿状況 */}
                    {(() => {
                      const secondWanted = (post as any).secondStageWanted;
                      if (post.status === "posted" && post.doublePostStatus) {
                        // If reservation explicitly set secondStageWanted === false, keep showing '投稿無し'
                        if (secondWanted === false) {
                          return <div className="text-xs">投稿無し</div>;
                        }
                        if (post.doublePostStatus === "done") {
                          return (
                            <div className="text-xs">
                              <div className="text-green-600 font-medium">投稿済</div>
                              {post.secondStageAt && (
                                <div className="text-gray-500">
                                  {typeof post.secondStageAt === "number"
                                    ? new Date(post.secondStageAt * 1000).toLocaleString()
                                    : new Date(post.secondStageAt).toLocaleString()}
                                </div>
                              )}
                            </div>
                          );
                        }
                        return (
                          <div className="text-xs">
                            <div className="text-yellow-600 font-medium">待機中</div>
                            {post.timeRange && (
                              <div className="text-gray-500 text-xs">範囲: {post.timeRange}</div>
                            )}
                          </div>
                        );
                      }

                      // 未投稿／未設定時の表示
                      if (post.status !== "posted") {
                        if (typeof secondWanted !== "undefined") {
                          return secondWanted === false ? (
                            <div className="text-xs">投稿無し</div>
                          ) : (
                            <div className="text-xs text-gray-500">投稿予定</div>
                          );
                        }
                        return <div className="text-xs text-gray-500">未設定</div>;
                      }

                      // 投稿済だが doublePostStatus が空など
                      return <div className="text-xs text-gray-500">未設定</div>;
                    })()}
                  </td>
                  {showDeleteControls && (
                    <td className="border p-1 text-center">
                      {/* 二段階投稿削除フラグ（日時ではなく設定による有無） */}
                      {(post as any).deleteOnSecondStage ? <span className="text-green-600 font-medium">有</span> : <span className="text-gray-500">無</span>}
                    </td>
                  )}
                  {showDeleteControls && (
                    <td className="border p-1 text-center">
                      {/* 親投稿削除フラグ */}
                      {(post as any).deleteParentAfter ? <span className="text-green-600 font-medium">有</span> : <span className="text-gray-500">無</span>}
                    </td>
                  )}
                  <td className="border p-1">
                    <button
                      className="px-2 py-1 rounded text-xs bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100 hover:bg-blue-200 dark:hover:bg-blue-700"
                      onClick={() =>
                        openReplies((post as any).replies || [], post.scheduledPostId)
                      }
                    >
                      {repliesStatus}
                    </button>
                  </td>
                  
                  <td className="border p-1 space-x-1">
                    {post.status !== "posted" && !post.isDeleted && (post as any).type !== 'quote' && (
                      <button
                        className={`text-white px-2 py-1 rounded ${
                          isPosting || accountIsDeleting ? "bg-green-300 cursor-not-allowed" : "bg-green-500 hover:bg-green-600"
                        }`}
                        onClick={() => handleManualRun(post)}
                        disabled={isPosting || accountIsDeleting}
                      >
                        {accountIsDeleting ? "削除中…" : isPosting ? "実行中…" : "即時投稿"}
                      </button>
                    )}
                    {/* 即時二段階投稿ボタン */}
                    {post.status === "posted" && 
                     post.doublePostStatus === "waiting" && 
                     !post.isDeleted && 
                     (post.secondStageWanted !== false) && ( // hide button if explicitly '投稿無し'
                      <button
                        className={`text-white px-2 py-1 rounded text-xs ${
                          secondStagePostingId === post.scheduledPostId 
                            ? "bg-purple-300 cursor-not-allowed" 
                            : "bg-purple-500 hover:bg-purple-600"
                        }`}
                        onClick={() => handleSecondStage(post.scheduledPostId)}
                        disabled={secondStagePostingId === post.scheduledPostId}
                      >
                        {secondStagePostingId === post.scheduledPostId ? "実行中…" : "二段階投稿"}
                      </button>
                    )}
                    {post.status !== "posted" && !post.isDeleted && (post as any).type !== 'quote' && (
                      <button
                        className="bg-yellow-500 text-white px-2 py-1 rounded hover:bg-yellow-600"
                        onClick={() => openEdit(post.scheduledPostId)}
                      >
                        編集
                      </button>
                    )}
                    {showDeleteControls && !post.isDeleted && (
                      <button
                        className="bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"
                        onClick={() => handleDelete(post.scheduledPostId)}
                      >
                        削除
                      </button>
                    )}

                  </td>
                </tr>
              );
            })}
            {sortedPosts.length === 0 && (
              <tr>
                <td colSpan={showDeleteControls ? 13 : 11} className="text-center text-gray-500 p-4">
                  データがありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 簡易リプモーダル（既存そのまま/簡略） */}
      {repliesModalOpen && (
        <div className="fixed inset-0 bg-black/30 flex justify-center items-center z-40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-96">
            <h3 className="text-lg font-bold mb-2">
              リプライ一覧（{repliesModalTarget}）
            </h3>
            <ul>
              {(repliesModalItems || []).map((r, idx) => (
                <li key={r.id || idx} className="mb-1 flex items-center">
                  <span className="flex-1">{r.replyContent}</span>
                  <span
                    className={`text-xs rounded px-2 py-0.5 ${
                      r.status === "replied"
                        ? "bg-green-200 text-green-800"
                        : "bg-gray-200 text-gray-800"
                    }`}
                  >
                    {r.status === "replied" ? "返信済" : "未返信"}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-end">
              <button
                className="bg-blue-500 text-white px-4 py-1 rounded hover:bg-blue-600"
                onClick={() => setRepliesModalOpen(false)}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* デバッグモーダル */}
      {debugModalOpen && debugData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl shadow-lg w-3/4 max-w-4xl max-h-3/4 overflow-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">🔍 デバッグ詳細情報</h3>
              <button
                className="text-gray-500 hover:text-gray-700"
                onClick={() => setDebugModalOpen(false)}
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-4">
              {/* 診断結果 */}
              <div className="p-3 bg-gray-50 rounded">
                <h4 className="font-semibold mb-2">診断結果</h4>
                <p className={`font-mono text-sm ${debugData.debugInfo?.diagnosis?.canPerformSecondStage ? 'text-green-600' : 'text-red-600'}`}>
                  {debugData.message}
                </p>
                {debugData.debugInfo?.diagnosis?.issues?.length > 0 && (
                  <ul className="mt-2 text-sm text-red-600">
                    {debugData.debugInfo.diagnosis.issues.map((issue: string, i: number) => (
                      <li key={i}>• {issue}</li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 投稿情報 */}
              <div className="p-3 bg-yellow-50 rounded">
                <h4 className="font-semibold mb-2">投稿情報</h4>
                <div className="text-sm space-y-1">
                  <div><strong>Post ID:</strong> {debugData.debugInfo?.scheduledPost?.postId || 'なし'}</div>
                  <div><strong>Numeric ID:</strong> {debugData.debugInfo?.scheduledPost?.numericPostId || 'なし'}</div>
                  <div><strong>Status:</strong> {debugData.debugInfo?.scheduledPost?.status}</div>
                  <div><strong>Double Status:</strong> {debugData.debugInfo?.scheduledPost?.doublePostStatus || 'なし'}</div>
                </div>
              </div>

              {/* アカウント情報 */}
              {debugData.debugInfo?.account && (
                <div className="p-3 bg-green-50 rounded">
                  <h4 className="font-semibold mb-2">アカウント情報</h4>
                  <div className="text-sm space-y-1">
                    <div><strong>Account ID:</strong> {debugData.debugInfo.account.accountId}</div>
                    <div><strong>Provider User ID:</strong> {debugData.debugInfo.account.providerUserId || 'なし'}</div>
                    <div><strong>Access Token:</strong> {debugData.debugInfo.account.hasAccessToken ? '設定済み' : '未設定'}</div>
                    <div><strong>Second Stage Content:</strong> {debugData.debugInfo.account.secondStageContentLength}文字</div>
                    {debugData.debugInfo.account.secondStageContent && (
                      <div className="mt-2 p-2 bg-white rounded text-xs">
                        {debugData.debugInfo.account.secondStageContent}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            
            <div className="mt-6 flex justify-end">
              <button
                className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
                onClick={() => setDebugModalOpen(false)}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
