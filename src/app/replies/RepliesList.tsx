// src/app/replies/RepliesList.tsx

"use client";

import React, { useState, useEffect } from "react";
import dayjs from "dayjs";

// ==========================
// 型定義
// ==========================

type ReplyStatus = "" | "draft" | "unreplied" | "replied";
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
  replyData?: ReplyType; // AI生成用のデータ
};

// ==========================
// ステータスフィルタ用
// ==========================
const statusOptions = [
  { value: "", label: "すべて" },
  { value: "draft", label: "下書き" },
  { value: "unreplied", label: "未返信" },
  { value: "replied", label: "返信済" },
];

// ==========================
// 返信内容編集モーダル
// ==========================
function EditModal({ open, onClose, onSave, value, replyData }: EditModalProps) {
  const [text, setText] = useState<string>(value);
  const [aiLoading, setAiLoading] = useState<boolean>(false);

  useEffect(() => { setText(value); }, [value]);

  // 自動生成（実際のAI API呼び出し）
  const handleAIGenerate = async () => {
    if (!replyData) return;
    
    setAiLoading(true);
    try {
      const response = await fetch("/api/ai-gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          purpose: "reply-generate",
          input: {
            originalPost: replyData.postContent,
            incomingReply: replyData.replyContent,
            accountId: replyData.accountId,
          },
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      
      setText(data.text || "（生成に失敗しました）");
      
    } catch (error: any) {
      console.error("AI generation error:", error);
      alert(`AI生成に失敗しました: ${error.message}`);
      setText("（AI生成に失敗しました）");
    } finally {
      setAiLoading(false);
    }
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
      // デバッグ: リプライがある箇所のみ抽出してアラート表示
      try {
        const results = data.results || [];
        const hasReplies = (r: any) => {
          if (r.fetched && r.fetched > 0) return true;
          if (Array.isArray(r.postsInfo) && r.postsInfo.some((p: any) => (p.repliesFound || 0) > 0 || p.hasReplyApiId)) return true;
          if (Array.isArray(r.apiLogs) && r.apiLogs.some((l: any) => (l.repliesFound || 0) > 0)) return true;
          return false;
        };
        const filtered = results.filter(hasReplies);
        const out = filtered.length > 0 ? { ok: true, results: filtered } : { ok: false, message: 'no replies found' };
        const jsonStr = JSON.stringify(out, null, 2);
        alert(jsonStr.length > 10000 ? jsonStr.slice(0, 10000) + "\n...truncated" : jsonStr);
      } catch (e) {
        console.log('[DEBUG] JSON processing failed:', e);
      }
      
      if (data.ok) {
        const results = data.results || [];
        const detailMsg = results.length > 0 ? 
          results.map((r: any) => {
            const parts = [`${r.displayName || r.accountId}: リプライ${r.fetched}件取得`];
            if (r.postsFound !== undefined) parts.push(`投稿${r.postsFound}件発見`);
            if (r.postsWithPostId !== undefined) parts.push(`postId有り${r.postsWithPostId}件`);
            if (r.error) parts.push(`エラー: ${r.error}`);
            
            // 投稿内容とAPI結果を追加
            if (r.postsInfo && r.postsInfo.length > 0) {
              const postsDetail = r.postsInfo.map((p: any, i: number) => 
                `[${i+1}] ${p.hasPostId ? 'ID:' + p.postId.substring(0, 8) + '...' : 'ID無し'} "${p.content}" → ${p.apiLog || '未処理'}`
              ).join('\n  ');
              parts.push(`\n  対象投稿:\n  ${postsDetail}`);
            }
            
            // API詳細ログを追加
            if (r.apiLogs && r.apiLogs.length > 0) {
              const apiDetail = r.apiLogs.map((log: any, i: number) => {
                const parts = [
                  `[${i+1}] postId: ${log.postId?.substring(0, 8)}...`,
                  `Status: ${log.status || 'N/A'}`,
                  `Found: ${log.repliesFound || 0}件`
                ];
                if (log.error) parts.push(`Error: ${log.error}`);
                if (log.response) parts.push(`Response: ${log.response}`);
                return parts.join(' / ');
              }).join('\n  ');
              parts.push(`\n  API詳細:\n  ${apiDetail}`);
            }
            
            return parts.join(' / ');
          }).join('\n\n') : 
          '処理対象アカウントなし';

        const summary = data.debug ? 
          `\n\n📊 全体サマリー:\n投稿${data.debug.totalPostsFound || 0}件発見 / postId有り${data.debug.totalPostsWithPostId || 0}件 / リプライ${data.debug.totalFetched || 0}件取得` : 
          '';
        
        alert(`✅ ${data.message}\n\n${detailMsg}${summary}`);
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
  const handleReply = async (id: string) => {
    const reply = replies.find(r => r.id === id);
    if (!reply) return;
    
    if (!reply.responseContent?.trim()) {
      alert("返信内容が入力されていません。編集ボタンで返信内容を入力してください。");
      return;
    }
    
    if (reply.status === "replied") {
      alert("この返信は既に送信済みです。");
      return;
    }
    
    if (!window.confirm(`この内容で返信を送信しますか？\n\n${reply.responseContent}`)) {
      return;
    }
    
    try {
      const response = await fetch("/api/replies/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          replyId: id,
          replyContent: reply.responseContent,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      
      // UIを更新
      setReplies(replies =>
        replies.map(r =>
          r.id === id
            ? { ...r, responseAt: dayjs().format("YYYY/MM/DD HH:mm"), status: "replied" }
            : r
        )
      );
      
      alert(`✅ 返信を送信しました！\n投稿ID: ${data.responsePostId}`);
      
    } catch (error: any) {
      console.error("Reply send error:", error);
      alert(`❌ 返信送信に失敗しました: ${error.message}`);
    }
  };

  const handleDelete = (id: string) => {
    if (!window.confirm("この返信内容を削除しますか？")) return;
    (async () => {
      try {
        const response = await fetch("/api/replies/delete", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ replyId: id }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        // 成功したらローカル state を更新（論理削除フラグに合わせて除外またはステータス更新）
        setReplies(prev => prev.map(r => r.id === id ? { ...r, status: 'deleted' as any } : r));
      } catch (e: any) {
        alert(`削除に失敗しました: ${e.message || String(e)}`);
      }
    })();
  };

  const handleEdit = (reply: ReplyType) => {
    setEditTarget(reply);
    setEditModalOpen(true);
  };

  const handleEditSave = async (newContent: string) => {
    if (!editTarget) return;
    
    try {
      const response = await fetch("/api/replies/update", {
        method: "PUT",
        headers: { 
          "Content-Type": "application/json" 
        },
        credentials: "include",
        body: JSON.stringify({
          replyId: editTarget.id,
          responseContent: newContent
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || `HTTP ${response.status}`);
      }
      
      // サーバー保存成功後にローカルstateを更新
      setReplies(replies =>
        replies.map(r =>
          r.id === editTarget.id
            ? { 
                ...r, 
                responseContent: newContent, 
                responseAt: dayjs().format("YYYY/MM/DD HH:mm"), 
                status: newContent.trim() ? "unreplied" : "draft"
              }
            : r
        )
      );
      setEditModalOpen(false);
      
      // 成功メッセージ
      console.log("✅ リプライ内容を保存しました");
      
    } catch (error: any) {
      console.error("Edit save error:", error);
      alert(`❌ 保存に失敗しました: ${error.message}`);
    }
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
        replyData={editTarget || undefined}
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
            {fetchingReplies ? "取得中..." : "⇓ リプライ取得"}
          </button>
        </div>
      </div>



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
                <td className="border p-1">
                  <div 
                    className="truncate max-w-xs cursor-pointer" 
                    title={r.postContent}
                    onClick={() => r.postContent && alert(`投稿本文:\n\n${r.postContent}`)}
                  >
                    {r.postContent}
                  </div>
                </td>
                <td className="border p-1">
                  <div 
                    className="truncate max-w-xs cursor-pointer" 
                    title={r.replyContent}
                    onClick={() => r.replyContent && alert(`リプライ内容:\n\n${r.replyContent}`)}
                  >
                    {r.replyContent}
                  </div>
                </td>
                <td className="border p-1">
                  <div 
                    className="truncate max-w-xs cursor-pointer" 
                    title={r.responseContent || "返信内容未作成"}
                    onClick={() => r.responseContent && alert(`返信内容:\n\n${r.responseContent}`)}
                  >
                    {r.responseContent || "（未作成）"}
                  </div>
                </td>
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
