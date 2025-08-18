// /src/app/scheduled-posts/ScheduledPostsTable.tsx
// [MOD] 投稿IDセル：投稿済みのときのみクリックで別タブ（postUrlがあればアンカー表示）
"use client";

import React, { useEffect, useState } from "react";
import ScheduledPostEditorModal, {
  ScheduledPostType,
} from "./ScheduledPostEditorModal";

// 既存定義は維持
type ScheduledPostStatus = "" | "pending" | "posted";
type ReplyType = { id: string; replyContent: string; status: "replied" | "unreplied" };

const statusOptions = [
  { value: "", label: "すべて" },
  { value: "pending", label: "未投稿" },
  { value: "posted", label: "投稿済み" },
];

export default function ScheduledPostsTable() {
  const [posts, setPosts] = useState<ScheduledPostType[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [sortKey, setSortKey] = useState<"scheduledAt" | "status">("scheduledAt");
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [filterStatus, setFilterStatus] =
    useState<ScheduledPostStatus>("");

  // [MOD] 新モーダルの管理
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"add" | "edit">("add");
  const [editorInitial, setEditorInitial] =
    useState<ScheduledPostType | null>(null);

  const [repliesModalOpen, setRepliesModalOpen] = useState(false);
  const [repliesModalTarget, setRepliesModalTarget] = useState<string>("");
  const [repliesModalItems, setRepliesModalItems] = useState<ReplyType[]>([]);

  // [ADD] 即時投稿の実行中フラグ（多重押し防止）
  const [postingId, setPostingId] = useState<string>("");

  // 一覧取得（既存API）
  useEffect(() => {
    fetch(`/api/scheduled-posts`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        setPosts(data.posts ?? []);
        setLoading(false);
      })
      .catch((e) => {
        alert(e.message);
        setLoading(false);
      });
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
    const resp = await fetch(`/api/scheduled-posts`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        scheduledPostId: edited.scheduledPostId,
        content: edited.content,
        scheduledAt: edited.scheduledAt,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.ok) {
      alert(`更新に失敗しました: ${data?.error || resp.statusText}`);
      return;
    }
    setPosts((prev) =>
      prev.map((p) =>
        p.scheduledPostId === edited.scheduledPostId ? { ...p, ...edited } : p
      )
    );
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

  const sortedPosts = posts
    .filter((post) => !post.isDeleted)
    .filter((post) => !filterStatus || (post.status || "pending") === filterStatus)
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
      // 成功したら postUrl / postId / postedAt / status を反映
      setPosts((prev) =>
        prev.map((x) =>
          x.scheduledPostId === p.scheduledPostId
            ? {
                ...x,
                status: "posted",
                postedAt: data.post.postedAt,
                postUrl: data.post.postUrl,
                postId: data.post.postId,
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
        <button
          onClick={openAdd}
          className="bg-blue-500 text-white rounded px-4 py-2 hover:bg-blue-600"
        >
          ＋予約投稿追加
        </button>
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
        <table className="min-w-full bg-white border">
          <thead>
            <tr>
              <th className="border p-1">アカウント名</th>
              <th className="border p-1">アカウントID</th>
              <th className="border p-1">予約投稿日時</th>
              <th className="border p-1">自動投稿</th>
              <th className="border p-1">生成テーマ</th>
              <th className="border p-1">本文テキスト</th>
              <th className="border p-1">投稿日時</th>
              <th className="border p-1">投稿ID</th>
              <th className="border p-1">リプ状況</th>
              <th className="border p-1">アクション</th>
            </tr>
          </thead>
          <tbody>
            {sortedPosts.map((post) => {
              const autoPostLabel = post.autoPostGroupId || "";
              const repliesNum = Number(post.replyCount ?? 0);
              const repliesStatus = `${0}/${repliesNum}`;
              const isPosting = postingId === post.scheduledPostId;

              // [FIX] 型エラー回避のため any キャストで postUrl を取得
              const pUrl = (post as any).postUrl as string | undefined;

              return (
                <tr key={post.scheduledPostId}>
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
                  <td className="border p-1">{post.content}</td>
                  <td className="border p-1">
                    {post.postedAt
                      ? typeof post.postedAt === "number"
                        ? new Date(post.postedAt * 1000).toLocaleString()
                        : post.postedAt
                      : ""}
                  </td>
                  <td className="border p-1">
                    {/* [ADD] postUrl が無い場合はプロフィールURLへフォールバック */}
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
                    <button
                      className="px-2 py-1 rounded text-xs bg-gray-200 text-gray-800 hover:bg-blue-200"
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
                <td colSpan={10} className="text-center text-gray-500 p-4">
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
    </div>
  );
}
