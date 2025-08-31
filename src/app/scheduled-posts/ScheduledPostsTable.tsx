// /src/app/scheduled-posts/ScheduledPostsTable.tsx
// [MOD] 投稿IDセル：投稿済みのときのみクリックで別タブ（postUrlがあればアンカー表示）
"use client";

import React, { useEffect, useState } from "react";
import ScheduledPostEditorModal, {
  ScheduledPostType,
} from "./ScheduledPostEditorModal";

// 既存定義は維持
type ScheduledPostStatus = "" | "scheduled" | "posted" | "expired";
type ReplyType = { id: string; replyContent: string; status: "replied" | "unreplied" };

const statusOptions = [
  { value: "", label: "すべて" },
  { value: "scheduled", label: "未投稿" },
  { value: "posted", label: "投稿済み" },
  { value: "expired", label: "期限切れ" },
];

export default function ScheduledPostsTable() {
  const [posts, setPosts] = useState<ScheduledPostType[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [sortKey, setSortKey] = useState<"scheduledAt" | "status">("scheduledAt");
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [filterStatus, setFilterStatus] = useState<ScheduledPostStatus>("");

  // [MOD] 新モーダルの管理
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"add" | "edit">("add");
  const [editorInitial, setEditorInitial] = useState<ScheduledPostType | null>(null);

  const [repliesModalOpen, setRepliesModalOpen] = useState(false);
  const [repliesModalTarget, setRepliesModalTarget] = useState<string>("");
  const [repliesModalItems, setRepliesModalItems] = useState<ReplyType[]>([]);
  // [ADD] bulk selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

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
    try {
      await fetch(`/api/scheduled-posts/bulk-delete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ scheduledPostIds: selectedIds }),
      });
      setPosts(prev => prev.map(p => selectedIds.includes(p.scheduledPostId) ? { ...p, isDeleted: true } : p));
      clearSelection();
    } catch (e: any) {
      alert(`削除に失敗しました: ${e.message || String(e)}`);
    }
  };

  // [ADD] 即時投稿の実行中フラグ（多重押し防止）
  const [postingId, setPostingId] = useState<string>("");
  
  // [ADD] 即時二段階投稿の実行中フラグ（多重押し防止）
  const [secondStagePostingId, setSecondStagePostingId] = useState<string>("");
  
  // [ADD] デバッグ関連のstate
  const [debugModalOpen, setDebugModalOpen] = useState<boolean>(false);
  const [debugData, setDebugData] = useState<any>(null);

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

  // 削除（既存）
  const handleDelete = async (id: string) => {
    if (!window.confirm("削除しますか？")) return;
    await fetch(`/api/scheduled-posts`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ scheduledPostId: id, isDeleted: true }),
    });
    setPosts((prev) =>
      prev.map((p) => (p.scheduledPostId === id ? { ...p, isDeleted: true } : p))
    );
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
      console.error("Second stage posting error:", e);
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
      console.error("Debug details error:", e);
      alert(`デバッグ情報の取得に失敗しました: ${e.message}`);
    }
  };



  const sortedPosts = posts
    .filter((post) => filterStatus ? (post.status || "scheduled") === filterStatus : true)
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
    }
  };

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

      {/* 既存ボタン群 */}
      <div className="flex justify-between items-center mb-4">
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
          >
            選択削除
          </button>
        </div>
      </div>

      <div className="flex space-x-2 mb-2">
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
              <th className="border p-1"><input type="checkbox" checked={selectedIds.length === sortedPosts.length && sortedPosts.length > 0} onChange={(e) => e.target.checked ? selectAllVisible() : clearSelection()} /></th>
              <th className="border p-1">アカウント名</th>
              <th className="border p-1">アカウントID</th>
              <th className="border p-1">予約投稿日時</th>
              <th className="border p-1">自動投稿</th>
              <th className="border p-1">生成テーマ</th>
              <th className="border p-1">本文テキスト</th>
              <th className="border p-1">投稿日時</th>
              <th className="border p-1">投稿ID</th>
              <th className="border p-1">二段階投稿</th>
              <th className="border p-1">二段階投稿削除</th>
              <th className="border p-1">投稿削除</th>
              <th className="border p-1">リプ状況</th>
              <th className="border p-1">アクション</th>
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
              // postIdからpostURLを生成
              const postId = (post as any).postId as string | undefined;
              const generatedUrl = postId ? `https://www.threads.net/post/${postId}` : undefined;

              const deleted = !!post.isDeleted;
              return (
                <tr key={post.scheduledPostId} className={deleted ? 'bg-gray-100 text-gray-500' : ''}>
                  <td className="border p-1">{!deleted && <input type="checkbox" checked={selectedIds.includes(post.scheduledPostId)} onChange={() => toggleSelect(post.scheduledPostId)} />}</td>
                  <td className="border p-1">{post.accountName}</td>
                  <td className="border p-1">{post.accountId}</td>
                  <td className="border p-1">
                    {post.scheduledAt
                      ? typeof post.scheduledAt === "number"
                        ? new Date(post.scheduledAt * 1000).toLocaleString()
                        : post.scheduledAt
                      : ""}
                  </td>
                  <td className="border p-1">{autoPostLabel}</td>
                  <td className="border p-1">{post.theme}</td>
                  <td className="border p-1">
                    <div 
                      className="truncate max-w-xs" 
                      title={post.content}
                    >
                      {post.content}
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
                    {/* [ADD] postUrl が無い場合はpostIdから生成したURLを使用、それもなければプロフィールURLへフォールバック */}
                    {post.status === "posted" ? (
                      pUrl ? (
                        <a
                          href={pUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 underline"
                          title="Threadsで開く"
                        >
                          {pUrl.split("/post/").pop() /* ショートコードだけ表示 */}
                        </a>
                      ) : generatedUrl ? (
                        <a
                          href={generatedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 underline"
                          title="Threadsで開く"
                        >
                          {postId /* postID表示 */}
                        </a>
                      ) : (
                        <a
                          href={`https://www.threads.com/@${encodeURIComponent(post.accountId || "")}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 underline"
                          title="プロフィールで確認"
                        >
                          プロフィール
                        </a>
                      )
                    ) : (
                      "" /* 未投稿 */
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
                  <td className="border p-1 text-center">
                    {/* 二段階投稿削除フラグ（日時ではなく設定による有無） */}
                    {(post as any).deleteOnSecondStage ? <span className="text-green-600 font-medium">有</span> : <span className="text-gray-500">無</span>}
                  </td>
                  <td className="border p-1 text-center">
                    {/* 親投稿削除フラグ */}
                    {(post as any).deleteParentAfter ? <span className="text-green-600 font-medium">有</span> : <span className="text-gray-500">無</span>}
                  </td>
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
                    {post.status !== "posted" && !post.isDeleted && (
                      <button
                        className={`text-white px-2 py-1 rounded ${
                          isPosting ? "bg-green-300 cursor-not-allowed" : "bg-green-500 hover:bg-green-600"
                        }`}
                        onClick={() => handleManualRun(post)}
                        disabled={isPosting}
                      >
                        {isPosting ? "実行中…" : "即時投稿"}
                      </button>
                    )}
                    {/* 即時二段階投稿ボタン */}
                    {post.status === "posted" && 
                     post.doublePostStatus === "waiting" && 
                     !post.isDeleted && (
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
                    {post.status !== "posted" && !post.isDeleted && (
                      <button
                        className="bg-yellow-500 text-white px-2 py-1 rounded hover:bg-yellow-600"
                        onClick={() => openEdit(post.scheduledPostId)}
                      >
                        編集
                      </button>
                    )}
                    {!post.isDeleted && (
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
                <td colSpan={11} className="text-center text-gray-500 p-4">
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
