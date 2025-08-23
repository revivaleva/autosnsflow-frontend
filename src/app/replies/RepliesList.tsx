// src/app/replies/RepliesList.tsx

"use client";

import React, { useState, useEffect } from "react";
import dayjs from "dayjs";

// ==========================
// 型定義
// ==========================

type ReplyStatus = "" | "replied" | "unreplied";
type ReplyType = {
  id: string;
  accountId: string;
  threadsPostedAt: string;
  postContent: string;
  replyContent: string;
  responseContent: string;
  responseAt: string;
  status: ReplyStatus;
};

type EditModalProps = {
  open: boolean;
  onClose: () => void;
  onSave: (value: string) => void;
  value: string;
};

// ==========================
// ステータスフィルタ用
// ==========================
const statusOptions = [
  { value: "", label: "すべて" },
  { value: "replied", label: "返信済" },
  { value: "unreplied", label: "未返信" },
];

// ==========================
// 返信内容編集モーダル
// ==========================
function EditModal({ open, onClose, onSave, value }: EditModalProps) {
  const [text, setText] = useState<string>(value);
  const [aiLoading, setAiLoading] = useState<boolean>(false);

  useEffect(() => { setText(value); }, [value]);

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
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
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

// ==========================
// 本体
// ==========================
export default function RepliesList() {
  const [replies, setReplies] = useState<ReplyType[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [statusFilter, setStatusFilter] = useState<ReplyStatus>("");
  const [accountFilter, setAccountFilter] = useState<string>("");
  const [sortKey, setSortKey] = useState<"threadsPostedAt" | "responseAt">("threadsPostedAt");
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [editModalOpen, setEditModalOpen] = useState<boolean>(false);
  const [editTarget, setEditTarget] = useState<ReplyType | null>(null);
  // デバッグ情報のstate
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [showDebug, setShowDebug] = useState<boolean>(false);
  
  // [ADD] リプライ取得の状態管理
  const [fetchingReplies, setFetchingReplies] = useState<boolean>(false);

  // 返信一覧を読み込む関数
  const loadReplies = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/replies", { credentials: "include" });
      const data = await response.json();
      
      setReplies(
        (data.replies || []).map((r: any): ReplyType => ({
          id: r.id,
          accountId: r.accountId,
          threadsPostedAt: r.scheduledAt
            ? dayjs(r.scheduledAt * 1000).format("YYYY/MM/DD HH:mm")
            : "",
          postContent: r.content,
          replyContent: r.incomingReply || "",
          responseContent: r.replyContent || "",
          responseAt: r.replyAt
            ? dayjs(r.replyAt * 1000).format("YYYY/MM/DD HH:mm")
            : "",
          status: r.status as ReplyStatus,
        }))
      );
      // デバッグ情報を保存
      setDebugInfo(data.debug || null);
    } catch (error: any) {
      alert(`読み込みエラー: ${error.message}`);
      setReplies([]);
    } finally {
      setLoading(false);
    }
  };

  // [ADD] リプライ手動取得関数
  const fetchReplies = async () => {
    if (fetchingReplies) return;
    
    setFetchingReplies(true);
    try {
      console.log("[CLIENT] リプライ取得開始...");
      const response = await fetch("/api/fetch-replies", { 
        method: "POST",
        credentials: "include" 
      });
      console.log("[CLIENT] API応答:", response.status, response.statusText);
      
      const data = await response.json();
      console.log("[CLIENT] レスポンスデータ:", data);
      
      if (data.ok) {
        const detailMsg = data.debug ? 
          `デバッグ情報:\n${JSON.stringify(data.debug, null, 2)}` : 
          `詳細: ${data.results.map((r: any) => `${r.displayName}: ${r.fetched}件`).join(', ')}`;
        alert(`✅ ${data.message}\n\n${detailMsg}`);
        // 取得後に一覧を再読み込み
        await loadReplies();
      } else {
        alert(`❌ リプライ取得に失敗しました: ${data.message || data.error}`);
      }
    } catch (error: any) {
      console.error("[CLIENT] リプライ取得エラー:", error);
      alert(`❌ リプライ取得エラー: ${error.message}`);
    } finally {
      setFetchingReplies(false);
    }
  };

  // APIからデータ取得
  useEffect(() => {
    loadReplies();
  }, []);

  // フィルタ
  const filteredReplies = replies.filter(r => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (accountFilter && r.accountId !== accountFilter) return false;
    return true;
  });

  // ソート
  const sortedReplies = [...filteredReplies].sort((a, b) => {
    let vA: string, vB: string;
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
  const handleReply = (id: string) => {
    alert(`即時返信: ${id}`);
    setReplies(replies =>
      replies.map(r =>
        r.id === id
          ? { ...r, responseContent: "（即時返信内容）", responseAt: dayjs().format("YYYY/MM/DD HH:mm"), status: "replied" }
          : r
      )
    );
  };

  const handleDelete = (id: string) => {
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

  const handleEdit = (reply: ReplyType) => {
    setEditTarget(reply);
    setEditModalOpen(true);
  };

  const handleEditSave = (newContent: string) => {
    if (!editTarget) return;
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

      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">リプライ一覧</h2>
        <div className="flex gap-2">
          <button
            onClick={loadReplies}
            disabled={loading}
            className="px-3 py-1 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded disabled:bg-gray-400"
          >
            {loading ? "読み込み中..." : "再読み込み"}
          </button>
          <button 
            onClick={fetchReplies}
            disabled={fetchingReplies || loading}
            className="px-3 py-1 text-sm bg-green-500 hover:bg-green-600 text-white rounded disabled:bg-gray-400"
          >
            {fetchingReplies ? "取得中..." : "リプライ取得"}
          </button>
          <button
            className="px-3 py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded"
            onClick={() => setShowDebug(!showDebug)}
          >
            {showDebug ? "デバッグ情報を隠す" : "デバッグ情報を表示"}
          </button>
        </div>
      </div>

      {/* デバッグ情報 */}
      {showDebug && debugInfo && (
        <div className="mb-4 p-4 bg-gray-100 rounded border">
          <h3 className="font-bold mb-2">デバッグ情報</h3>
          <p><strong>ユーザーID:</strong> {debugInfo.userId}</p>
          <p><strong>DynamoDBテーブル:</strong> {debugInfo.tableName}</p>
          <p><strong>DBからの取得件数:</strong> {debugInfo.totalItemsInDB}件</p>
          {debugInfo.sampleRawItem ? (
            <details className="mt-2">
              <summary className="cursor-pointer font-semibold">サンプルDBアイテム（1件目）</summary>
              <pre className="mt-2 text-xs bg-white p-2 rounded overflow-auto">
                {JSON.stringify(debugInfo.sampleRawItem, null, 2)}
              </pre>
            </details>
          ) : (
            <p className="text-red-600 mt-2">⚠️ データベースにリプライデータが存在しません</p>
          )}
        </div>
      )}

      {/* リプライ取得に関する案内 */}
      {replies.length === 0 && !loading && (
        <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded">
          <h3 className="font-bold text-yellow-800 mb-2">リプライが取得できていません</h3>
          <p className="text-yellow-700 mb-2">以下の点をご確認ください：</p>
          <ul className="list-disc list-inside text-yellow-700 text-sm space-y-1">
            <li>
              <a href="/accounts" className="text-blue-600 hover:underline">アカウント設定</a>
              で「リプ返信」機能がオンになっているか
            </li>
            <li>Lambda関数が定期実行されているか
              <details className="ml-4 mt-1">
                <summary className="cursor-pointer text-xs text-blue-600">ログ確認方法</summary>
                <div className="text-xs mt-1 p-2 bg-white rounded border">
                  <p className="mb-1"><strong>AWS CLIコマンド:</strong></p>
                  <code className="block bg-gray-100 p-1 rounded">
                    aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/scheduled-autosnsflow"
                  </code>
                  <p className="mt-2 mb-1"><strong>ログの確認:</strong></p>
                  <code className="block bg-gray-100 p-1 rounded">
                    aws logs tail /aws/lambda/scheduled-autosnsflow --follow
                  </code>
                </div>
              </details>
            </li>
            <li>Threadsのアクセストークンが有効で、適切な権限があるか</li>
            <li>実際にThreads投稿にリプライが投稿されているか</li>
          </ul>
        </div>
      )}

      {/* フィルタ */}
      <div className="flex flex-wrap gap-4 mb-4">
        <select
          className="border rounded px-2 py-1"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as ReplyStatus)}
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
