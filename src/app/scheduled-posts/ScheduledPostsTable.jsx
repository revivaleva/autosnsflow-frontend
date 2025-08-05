"use client";

import React, { useState } from "react";

// サンプル自動投稿グループデータ
const groups = [
  { groupId: "group1", groupName: "朝昼夕グループ" },
  { groupId: "group2", groupName: "テストグループ" },
];

// サンプルの予約投稿データ
const initialPosts = [
  {
    id: "post1",
    accountName: "営業アカウント",
    accountId: "accountA",
    platform: "Threads",
    scheduledAt: "2025/08/05 10:00",
    groupId: "group1",
    groupOrder: 0,
    theme: "おはよう",
    content: "今日も一日頑張ろう！",
    threadsPostedAt: "2025/08/05 10:05",
    twitterPostedAt: "",
    threadsPostId: "th12345",
    twitterPostId: "",
    replies: [
      { id: "r1", content: "返信ありがとう", status: "replied" },
      { id: "r2", content: "未返信です", status: "unreplied" },
      { id: "r3", content: "未返信その2", status: "unreplied" },
    ],
    status: "posted",
  },
  {
    id: "post2",
    accountName: "副業アカウント",
    accountId: "accountB",
    platform: "X(Twitter)",
    scheduledAt: "2025/08/05 12:00",
    groupId: "group2",
    groupOrder: 1,
    theme: "ランチ",
    content: "今日のランチはカレー！",
    threadsPostedAt: "",
    twitterPostedAt: "2025/08/05 12:03",
    threadsPostId: "",
    twitterPostId: "tw54321",
    replies: [
      { id: "r1", content: "美味しそう", status: "replied" },
      { id: "r2", content: "今度食べたい", status: "replied" },
      { id: "r3", content: "何カレー？", status: "replied" },
    ],
    status: "pending",
  },
];

// ステータスフィルタ用
const statusOptions = [
  { value: "", label: "すべて" },
  { value: "pending", label: "未投稿" },
  { value: "posted", label: "投稿済み" },
];

function RepliesModal({ open, onClose, replies, postId }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-96">
        <h3 className="text-lg font-bold mb-2">リプライ一覧（{postId}）</h3>
        <ul>
          {replies.map((r) => (
            <li key={r.id} className="mb-1 flex items-center">
              <span className="flex-1">{r.content}</span>
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

// 編集モーダル
function EditPostModal({ open, onClose, post, onSave }) {
  const [scheduledAt, setScheduledAt] = useState(post?.scheduledAt || "");
  const [content, setContent] = useState(post?.content || "");
  const [regenLoading, setRegenLoading] = useState(false);

  // 本文再生成（ダミーでテキスト変更）
  const handleRegenerate = () => {
    setRegenLoading(true);
    setTimeout(() => {
      setContent("（AIで再生成されたサンプルテキスト）");
      setRegenLoading(false);
    }, 800);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      ...post,
      scheduledAt,
      content,
    });
  };

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

export default function ScheduledPostsTable() {
  const [posts, setPosts] = useState(initialPosts);
  const [sortKey, setSortKey] = useState("scheduledAt");
  const [sortAsc, setSortAsc] = useState(true);
  const [filterStatus, setFilterStatus] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalReplies, setModalReplies] = useState([]);
  const [modalTarget, setModalTarget] = useState(null);

  // 編集モーダル制御
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  // グループ名取得
  const getGroupName = (groupId) => {
    const group = groups.find(g => g.groupId === groupId);
    return group ? group.groupName : "";
  };

  // ソート＋フィルタ
  const sortedPosts = posts
    .filter((post) => !filterStatus || post.status === filterStatus)
    .sort((a, b) => {
      if (sortKey === "scheduledAt") {
        return sortAsc
          ? a.scheduledAt.localeCompare(b.scheduledAt)
          : b.scheduledAt.localeCompare(a.scheduledAt);
      }
      if (sortKey === "status") {
        return sortAsc
          ? a.status.localeCompare(b.status)
          : b.status.localeCompare(a.status);
      }
      return 0;
    });

  // アクション
  const handleManualRun = (id) => alert(`即時投稿: ${id}`);
  const handleEdit = (id) => {
    const post = posts.find((p) => p.id === id);
    setEditTarget(post);
    setEditModalOpen(true);
  };
  const handleEditSave = (edited) => {
    setPosts((prev) =>
      prev.map((p) => (p.id === edited.id ? { ...p, ...edited } : p))
    );
    setEditModalOpen(false);
  };
  const handleDelete = (id) => window.confirm("削除しますか？") && setPosts(posts.filter((p) => p.id !== id));
  const handleAdd = () => alert("予約投稿追加モーダルを表示（仮）");
  const handleRepliesModal = (replies, postId) => {
    setModalReplies(replies);
    setModalTarget(postId);
    setModalOpen(true);
  };

  return (
    <div className="p-4">
      <RepliesModal open={modalOpen} onClose={() => setModalOpen(false)} replies={modalReplies} postId={modalTarget} />
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
          onChange={(e) => setFilterStatus(e.target.value)}
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
              const groupName = getGroupName(post.groupId);
              const autoPostLabel =
                groupName && typeof post.groupOrder === "number"
                  ? `${groupName}-自動投稿${post.groupOrder + 1}`
                  : "";

              const repliesNum = post.replies?.length || 0;
              const repliesReplied = post.replies?.filter(r => r.status === "replied").length || 0;
              const repliesStatus = `${repliesReplied}/${repliesNum}`;

              return (
                <tr key={post.id}>
                  <td className="border p-1">{post.accountName}</td>
                  <td className="border p-1">{post.accountId}</td>
                  <td className="border p-1">{post.scheduledAt}</td>
                  <td className="border p-1">{autoPostLabel}</td>
                  <td className="border p-1">{post.theme}</td>
                  <td className="border p-1">{post.content}</td>
                  <td className="border p-1">{post.threadsPostedAt}</td>
                  <td className="border p-1">{post.threadsPostId}</td>
                  <td className="border p-1">
                    <button
                      className="px-2 py-1 rounded text-xs bg-gray-200 text-gray-800 hover:bg-blue-200"
                      onClick={() => handleRepliesModal(post.replies || [], post.id)}
                    >
                      {repliesStatus}
                    </button>
                  </td>
                  <td className="border p-1 space-x-1">
                    <button
                      className="bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600"
                      onClick={() => handleManualRun(post.id)}
                    >
                      即時投稿
                    </button>
                    {/* 投稿済みでなければ編集ボタンを表示 */}
                    {post.status !== "posted" && (
                      <button
                        className="bg-yellow-500 text-white px-2 py-1 rounded hover:bg-yellow-600"
                        onClick={() => handleEdit(post.id)}
                      >
                        編集
                      </button>
                    )}
                    <button
                      className="bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"
                      onClick={() => handleDelete(post.id)}
                    >
                      削除
                    </button>
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
