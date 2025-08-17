// src/app/scheduled-posts/ScheduledPostsTable.tsx

"use client";

import React, { useEffect, useState } from "react";

// 型定義
type ScheduledPostStatus = "" | "pending" | "posted";
type ScheduledPostType = {
  scheduledPostId: string;
  accountName: string;
  accountId: string;
  scheduledAt: string | number;
  content: string;
  theme?: string;
  autoPostGroupId?: string;
  status?: ScheduledPostStatus;
  postedAt?: string | number;
  threadsPostId?: string;
  isDeleted?: boolean;
  replyCount?: number;
  replies?: ReplyType[];
};
type ReplyType = {
  id: string;
  replyContent: string;
  status: "replied" | "unreplied";
};

type AddPostModalProps = {
  open: boolean;
  onClose: () => void;
  onSave: (data: ScheduledPostType) => void;
};
type RepliesModalProps = {
  open: boolean;
  onClose: () => void;
  replies: ReplyType[];
  postId: string;
};
type EditPostModalProps = {
  open: boolean;
  onClose: () => void;
  post: ScheduledPostType | null;
  onSave: (data: ScheduledPostType) => void;
};

const statusOptions = [
  { value: "", label: "すべて" },
  { value: "pending", label: "未投稿" },
  { value: "posted", label: "投稿済み" },
];

// ---------------- AddPostModal ----------------
function AddPostModal({ open, onClose, onSave }: AddPostModalProps) {
  const [accountName, setAccountName] = useState<string>("");
  const [accountId, setAccountId] = useState<string>("");
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [theme, setTheme] = useState<string>("");
  const [autoPostGroupId, setAutoPostGroupId] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    const scheduledPostId = Math.random().toString(36).slice(2, 12);
    await onSave({
      scheduledPostId,
      accountName,
      accountId,
      scheduledAt,
      content,
      theme,
      autoPostGroupId,
    });
    setSaving(false);
    onClose();
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center z-50">
      <form className="bg-white rounded-xl shadow-xl p-6 w-[400px]" onSubmit={handleSubmit}>
        <h3 className="text-lg font-bold mb-3">予約投稿追加</h3>
        <div className="mb-2">
          <label className="block text-xs text-gray-600 mb-1">アカウント名</label>
          <input className="w-full border rounded px-2 py-1"
            value={accountName} onChange={e => setAccountName(e.target.value)} required />
        </div>
        <div className="mb-2">
          <label className="block text-xs text-gray-600 mb-1">アカウントID</label>
          <input className="w-full border rounded px-2 py-1"
            value={accountId} onChange={e => setAccountId(e.target.value)} required />
        </div>
        <div className="mb-2">
          <label className="block text-xs text-gray-600 mb-1">予約投稿日時（UNIX秒）</label>
          <input className="w-full border rounded px-2 py-1"
            value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} required />
        </div>
        <div className="mb-2">
          <label className="block text-xs text-gray-600 mb-1">テーマ</label>
          <input className="w-full border rounded px-2 py-1"
            value={theme} onChange={e => setTheme(e.target.value)} />
        </div>
        <div className="mb-2">
          <label className="block text-xs text-gray-600 mb-1">本文テキスト</label>
          <textarea className="w-full border rounded px-2 py-1"
            rows={3}
            value={content} onChange={e => setContent(e.target.value)} />
        </div>
        <div className="mb-2">
          <label className="block text-xs text-gray-600 mb-1">自動投稿グループID</label>
          <input className="w-full border rounded px-2 py-1"
            value={autoPostGroupId} onChange={e => setAutoPostGroupId(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <button type="button" className="bg-gray-300 text-gray-800 rounded px-4 py-2"
            onClick={onClose}>キャンセル</button>
          <button type="submit" disabled={saving}
            className="bg-green-500 text-white rounded px-5 py-2 hover:bg-green-600">
            {saving ? "追加中..." : "追加"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------- RepliesModal ----------------
function RepliesModal({ open, onClose, replies, postId }: RepliesModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-96">
        <h3 className="text-lg font-bold mb-2">リプライ一覧（{postId}）</h3>
        <ul>
          {(replies || []).map((r, idx) => (
            <li key={r.id || idx} className="mb-1 flex items-center">
              <span className="flex-1">{r.replyContent}</span>
              <span className={`text-xs rounded px-2 py-0.5 ${r.status === "replied" ? "bg-green-200 text-green-800" : "bg-gray-200 text-gray-800"}`}>
                {r.status === "replied" ? "返信済" : "未返信"}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-end">
          <button className="bg-blue-500 text-white px-4 py-1 rounded hover:bg-blue-600" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}

// ---------------- EditPostModal ----------------
function EditPostModal({ open, onClose, post, onSave }: EditPostModalProps) {
  const [scheduledAt, setScheduledAt] = useState<string | number>(post?.scheduledAt || "");
  const [content, setContent] = useState<string>(post?.content || "");
  const [regenLoading, setRegenLoading] = useState<boolean>(false);

  const handleRegenerate = () => {
    setRegenLoading(true);
    setTimeout(() => {
      setContent("（AIで再生成されたサンプルテキスト）");
      setRegenLoading(false);
    }, 800);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!post) return;
    onSave({
      ...post,
      scheduledAt,
      content,
    });
  };

  useEffect(() => {
    if (post) {
      setScheduledAt(post.scheduledAt || "");
      setContent(post.content || "");
    }
  }, [post]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center z-50">
      <form
        className="bg-white rounded-xl shadow-xl p-6 w-[400px]"
        onSubmit={handleSubmit}
      >
        <h3 className="text-lg font-bold mb-3">予約投稿編集</h3>
        <div className="mb-2">
          <label className="block text-xs text-gray-600 mb-1">アカウント名</label>
          <input
            className="w-full border rounded px-2 py-1 bg-gray-100"
            value={post?.accountName ?? ""}
            disabled
          />
        </div>
        <div className="mb-2">
          <label className="block text-xs text-gray-600 mb-1">アカウントID</label>
          <input
            className="w-full border rounded px-2 py-1 bg-gray-100"
            value={post?.accountId ?? ""}
            disabled
          />
        </div>
        <div className="mb-2">
          <label className="block text-xs text-gray-600 mb-1">予約投稿日時</label>
          <input
            className="w-full border rounded px-2 py-1"
            value={scheduledAt}
            onChange={e => setScheduledAt(e.target.value)}
          />
        </div>
        <div className="mb-2">
          <label className="block text-xs text-gray-600 mb-1">本文テキスト</label>
          <textarea
            className="w-full border rounded px-2 py-1"
            rows={3}
            value={content}
            onChange={e => setContent(e.target.value)}
          />
        </div>
        <div className="mb-3">
          <button
            type="button"
            className="bg-blue-500 text-white rounded px-3 py-1 hover:bg-blue-600 disabled:bg-gray-400 mr-2"
            onClick={handleRegenerate}
            disabled={regenLoading}
          >
            {regenLoading ? "生成中..." : "再生成"}
          </button>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="bg-gray-300 text-gray-800 rounded px-4 py-2"
            onClick={onClose}
          >キャンセル</button>
          <button
            type="submit"
            className="bg-green-500 text-white rounded px-5 py-2 hover:bg-green-600"
          >保存</button>
        </div>
      </form>
    </div>
  );
}

// ---------------- ScheduledPostsTable本体 ----------------
export default function ScheduledPostsTable() {
  const [posts, setPosts] = useState<ScheduledPostType[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [sortKey, setSortKey] = useState<"scheduledAt" | "status">("scheduledAt");
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [filterStatus, setFilterStatus] = useState<ScheduledPostStatus>("");
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [modalReplies, setModalReplies] = useState<ReplyType[]>([]);
  const [modalTarget, setModalTarget] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState<boolean>(false);
  const [editModalOpen, setEditModalOpen] = useState<boolean>(false);
  const [editTarget, setEditTarget] = useState<ScheduledPostType | null>(null);

  const handleAdd = () => setAddModalOpen(true);

  const handleRepliesModal = (replies: ReplyType[], postId: string) => {
    setModalReplies(replies || []);
    setModalTarget(postId);
    setModalOpen(true);
  };

  // userIdは一切使わず、credentials: "include"のみでAPIアクセス
  useEffect(() => {
    fetch(`/api/scheduled-posts`, {
      credentials: "include"
    })
      .then(res => res.json())
      .then(data => {
        setPosts(data.posts ?? []);
        setLoading(false);
      })
      .catch(e => {
        alert(e.message);
        setLoading(false);
      });
  }, []);

  // モーダル保存時
  const handleAddSave = async (newPost: ScheduledPostType) => {
    let scheduledAt = newPost.scheduledAt;
    if (scheduledAt && String(scheduledAt).length < 11) {
      scheduledAt = Number(scheduledAt);
    }

    try {
      const resp = await fetch(`/api/scheduled-posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...newPost, scheduledAt }),
      });
      // [FIX] 成否チェック（APIは success:true を返す）
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.success) {
        alert(`保存に失敗しました: ${data?.error || resp.statusText}`);
        return; // ← [FIX] 失敗時はローカル追加しない
      }
      // [FIX] 成功時のみローカルへ反映
      setPosts((prev) => [...prev, { ...newPost, scheduledAt }]);
    } catch (e: any) {
      alert(`保存エラー: ${e?.message || e}`);
    }
  };

  const handleEdit = (id: string) => {
    const post = posts.find((p) => p.scheduledPostId === id);
    setEditTarget(post || null);
    setEditModalOpen(true);
  };
  const handleEditSave = (edited: ScheduledPostType) => {
    setPosts((prev) =>
      prev.map((p) =>
        p.scheduledPostId === edited.scheduledPostId ? { ...p, ...edited } : p
      )
    );
    setEditModalOpen(false);
  };
  const handleDelete = async (id: string) => {
    if (!window.confirm("削除しますか？")) return;
    await fetch(`/api/scheduled-posts`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ scheduledPostId: id, isDeleted: true }),
    });
    setPosts(posts =>
      posts.map(p =>
        p.scheduledPostId === id ? { ...p, isDeleted: true } : p
      )
    );
  };

  // ソート＋フィルタ
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

  const handleManualRun = (id: string) => alert(`即時投稿: ${id}`);

  if (loading)
    return <div className="p-6 text-center">読み込み中...</div>;

  return (
    <div className="p-4">
      <AddPostModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onSave={handleAddSave}
      />
      <RepliesModal open={modalOpen} onClose={() => setModalOpen(false)} replies={modalReplies} postId={modalTarget || ""} />
      <EditPostModal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        post={editTarget}
        onSave={handleEditSave}
      />

      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">予約投稿一覧</h2>
        <button
          onClick={handleAdd}
          className="bg-blue-500 text-white rounded px-4 py-2 hover:bg-blue-600"
        >
          ＋予約投稿追加
        </button>
      </div>
      <div className="flex space-x-2 mb-2">
        <select
          className="border rounded p-1"
          value={filterStatus}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterStatus(e.target.value as ScheduledPostStatus)}
        >
          {statusOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
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
              const repliesNum = Number(post.replyCount ?? (post.replies?.length ?? 0));
              const repliesReplied = post.replies?.filter(r => r.status === "replied").length ?? 0;
              const repliesStatus = repliesNum ? `${repliesReplied}/${repliesNum}` : "0/0";

              return (
                <tr key={post.scheduledPostId}>
                  <td className="border p-1">{post.accountName}</td>
                  <td className="border p-1">{post.accountId}</td>
                  <td className="border p-1">
                    {post.scheduledAt
                      ? (typeof post.scheduledAt === "number"
                        ? new Date(post.scheduledAt * 1000).toLocaleString()
                        : post.scheduledAt)
                      : ""}
                  </td>
                  <td className="border p-1">{autoPostLabel}</td>
                  <td className="border p-1">{post.theme}</td>
                  <td className="border p-1">{post.content}</td>
                  <td className="border p-1">
                    {post.postedAt
                      ? (typeof post.postedAt === "number"
                        ? new Date(post.postedAt * 1000).toLocaleString()
                        : post.postedAt)
                      : ""}
                  </td>
                  <td className="border p-1">{post.threadsPostId || post.scheduledPostId}</td>
                  <td className="border p-1">
                    <button
                      className="px-2 py-1 rounded text-xs bg-gray-200 text-gray-800 hover:bg-blue-200"
                      onClick={() => handleRepliesModal(post.replies || [], post.scheduledPostId)}
                    >
                      {repliesStatus}
                    </button>
                  </td>
                  <td className="border p-1 space-x-1">
                    {post.status !== "posted" && !post.isDeleted && (
                      <button
                        className="bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600"
                        onClick={() => handleManualRun(post.scheduledPostId)}
                      >
                        即時投稿
                      </button>
                    )}
                    {post.status !== "posted" && !post.isDeleted && (
                      <button
                        className="bg-yellow-500 text-white px-2 py-1 rounded hover:bg-yellow-600"
                        onClick={() => handleEdit(post.scheduledPostId)}
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
    </div>
  );
}
