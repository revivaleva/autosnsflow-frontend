"use client";

import React, { useState, useEffect } from "react";
import dayjs from "dayjs";

// ステータスフィルタ用
const statusOptions = [
  { value: "", label: "すべて" },
  { value: "replied", label: "返信済" },
  { value: "unreplied", label: "未返信" },
];

// 返信内容編集モーダル（自動生成ボタン付き）
function EditModal({ open, onClose, onSave, value }) {
  const [text, setText] = useState(value);
  const [aiLoading, setAiLoading] = useState(false);

  React.useEffect(() => { setText(value); }, [value]);

  // 自動生成
  const handleAIGenerate = () => {
    setAiLoading(true);
    setTimeout(() => {
      setText("（AIで自動生成された返信内容サンプル）");
      setAiLoading(false);
    }, 800);
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-xl shadow w-96">
        <div className="font-bold mb-2">返信内容編集</div>
        <textarea
          className="border rounded w-full p-2 mb-4"
          rows={4}
          value={text}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
        />
        <div className="flex justify-between mb-2">
          <button
            className="px-4 py-1 rounded bg-blue-500 text-white disabled:bg-gray-400"
            type="button"
            onClick={handleAIGenerate}
            disabled={aiLoading}
          >
            {aiLoading ? "生成中..." : "自動生成"}
          </button>
          <div className="flex gap-2">
            <button className="px-4 py-1 rounded bg-gray-300" type="button" onClick={onClose}>キャンセル</button>
            <button className="px-4 py-1 rounded bg-blue-500 text-white" type="button" onClick={() => onSave(text)}>保存</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RepliesList() {
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [sortKey, setSortKey] = useState("threadsPostedAt");
  const [sortAsc, setSortAsc] = useState(true);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  // APIからデータ取得
  useEffect(() => {
    const userId = localStorage.getItem("userId");
    if (!userId) return;
    setLoading(true);
    fetch(`/api/replies?userId=${userId}`)
      .then(res => res.json())
      .then(data => {
        // APIのレスポンス形式に合わせてkey変換
        setReplies(
          (data.replies || []).map(r => ({
            id: r.id,
            accountId: r.accountId,                             // ここはAPIレスポンスのプロパティ名
            threadsPostedAt: r.scheduledAt
              ? dayjs(r.scheduledAt * 1000).format("YYYY/MM/DD HH:mm")
              : "",
            postContent: r.content,                             // 本文テキスト
            replyContent: r.replyContent || "",                 // リプ内容
            responseContent: r.responseContent || "",           // 返信内容
            responseAt: r.replyAt
              ? dayjs(r.replyAt * 1000).format("YYYY/MM/DD HH:mm")
              : "",
            status: r.status,
          }))
        );

        setLoading(false);
      })
      .catch(e => {
        setReplies([]);
        setLoading(false);
      });
  }, []);

  // フィルタ
  const filteredReplies = replies.filter(r => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (accountFilter && r.accountId !== accountFilter) return false;
    return true;
  });

  // ソート
  const sortedReplies = [...filteredReplies].sort((a, b) => {
    let vA, vB;
    if (sortKey === "threadsPostedAt") {
      vA = a.threadsPostedAt || "";
      vB = b.threadsPostedAt || "";
    } else if (sortKey === "responseAt") {
      vA = a.responseAt || "";
      vB = b.responseAt || "";
    } else {
      return 0;
    }
    return sortAsc
      ? vA.localeCompare(vB)
      : vB.localeCompare(vA);
  });

  // アクション
  const handleReply = (id) => {
    alert(`即時返信: ${id}`);
    setReplies(replies =>
      replies.map(r =>
        r.id === id
          ? { ...r, responseContent: "（即時返信内容）", responseAt: dayjs().format("YYYY/MM/DD HH:mm"), status: "replied" }
          : r
      )
    );
  };

  const handleDelete = (id) => {
    if (window.confirm("この返信内容を削除しますか？")) {
      setReplies(replies =>
        replies.map(r =>
          r.id === id
            ? { ...r, responseContent: "", responseAt: dayjs().format("YYYY/MM/DD HH:mm"), status: "replied" }
            : r
        )
      );
    }
  };

  const handleEdit = (reply) => {
    setEditTarget(reply);
    setEditModalOpen(true);
  };

  const handleEditSave = (newContent) => {
    setReplies(replies =>
      replies.map(r =>
        r.id === editTarget.id
          ? { ...r, responseContent: newContent, responseAt: dayjs().format("YYYY/MM/DD HH:mm"), status: "replied" }
          : r
      )
    );
    setEditModalOpen(false);
  };

  // アカウントID一覧（フィルタ用）
  const accountIds = Array.from(new Set(replies.map(r => r.accountId)));

  if (loading) return <div className="p-6 text-center">読み込み中...</div>;

  return (
    <div className="p-4">
      <EditModal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        onSave={handleEditSave}
        value={editTarget?.responseContent || ""}
      />

      <h2 className="text-xl font-bold mb-4">リプライ一覧</h2>

      {/* フィルタ */}
      <div className="flex flex-wrap gap-4 mb-4">
        <select
          className="border rounded px-2 py-1"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          {statusOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          className="border rounded px-2 py-1"
          value={accountFilter}
          onChange={e => setAccountFilter(e.target.value)}
        >
          <option value="">全アカウント</option>
          {accountIds.map(id => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full bg-white border">
          <thead>
            <tr>
              <th className="border p-1">アカウントID</th>
              <th className="border p-1">
                <button
                  className="flex items-center font-semibold"
                  onClick={() => {
                    setSortKey("threadsPostedAt");
                    setSortAsc(sortKey === "threadsPostedAt" ? !sortAsc : true);
                  }}
                >
                  Threads投稿日時
                  {sortKey === "threadsPostedAt" && (
                    <span>{sortAsc ? " ▲" : " ▼"}</span>
                  )}
                </button>
              </th>
              <th className="border p-1">本文テキスト</th>
              <th className="border p-1">リプ内容</th>
              <th className="border p-1">返信内容</th>
              <th className="border p-1">
                <button
                  className="flex items-center font-semibold"
                  onClick={() => {
                    setSortKey("responseAt");
                    setSortAsc(sortKey === "responseAt" ? !sortAsc : true);
                  }}
                >
                  返信日時
                  {sortKey === "responseAt" && (
                    <span>{sortAsc ? " ▲" : " ▼"}</span>
                  )}
                </button>
              </th>
              <th className="border p-1">アクション</th>
            </tr>
          </thead>
          <tbody>
            {sortedReplies.map(r => (
              <tr key={r.id}>
                <td className="border p-1">{r.accountId}</td>
                <td className="border p-1">{r.threadsPostedAt}</td>
                <td className="border p-1">{r.postContent}</td>
                <td className="border p-1">{r.replyContent}</td>
                <td className="border p-1">{r.responseContent}</td>
                <td className="border p-1">{r.responseAt}</td>
                <td className="border p-1 space-x-1">
                  {/* 返信済みの行はボタン非表示 */}
                  {r.status !== "replied" && (
                    <>
                      <button
                        className="bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600"
                        onClick={() => handleReply(r.id)}
                      >
                        即時返信
                      </button>
                      <button
                        className="bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"
                        onClick={() => handleDelete(r.id)}
                      >
                        削除
                      </button>
                      <button
                        className="bg-yellow-500 text-white px-2 py-1 rounded hover:bg-yellow-600"
                        onClick={() => handleEdit(r)}
                      >
                        編集
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {sortedReplies.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-gray-500 p-4">
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
