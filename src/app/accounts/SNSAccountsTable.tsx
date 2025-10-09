// /src/app/accounts/SNSAccountsTable.tsx

"use client";

import React, { useEffect, useState } from "react";
import ToggleSwitch from "@/components/ToggleSwitch";
import SNSAccountModal from "./SNSAccountModal";

// 型定義
export type ThreadsAccount = {
  accountId: string;
  displayName: string;
  createdAt: number;
  autoPost: boolean;
  autoGenerate: boolean;
  autoReply: boolean;
  statusMessage: string;
  // アカウントの状態（例: 'active', 'deleting', 'deletion_error' 等）
  status?: string;
  personaMode: string;
  personaSimple: string;
  personaDetail: string;
  autoPostGroupId: string;
  /** ▼追加: 2段階投稿用のThreads投稿本文 */
  secondStageContent?: string;
  // [ADD] アクセストークン（モーダル編集用）
  accessToken?: string;
};

export default function SNSAccountsTable() {
  const [accounts, setAccounts] = useState<ThreadsAccount[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // モーダル関連
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [selectedAccount, setSelectedAccount] = useState<ThreadsAccount | null>(null);

  // [ADD] 更新中アカウントの制御（多重クリック防止＆UI無効化）
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  // 表示制御: 設定でアプリ列を非表示にできる
  const [showAppColumn, setShowAppColumn] = useState<boolean>(true);
  // 新規作成を許可するかどうかのフラグ（UserSettings.maxThreadsAccounts を考慮）
  const [canCreateAccount, setCanCreateAccount] = useState<boolean>(true);
  // max allowed and current count for display
  const [maxThreadsAllowed, setMaxThreadsAllowed] = useState<number | null>(null);
  const [currentAccountsCount, setCurrentAccountsCount] = useState<number>(0);

  // /src/app/accounts/SNSAccountsTable.tsx
  // [FIX] GET応答が {accounts} / {items} 両方来ても動くように
  // （他はそのまま。トグルは前回の修正のままでOK）
  const loadAccounts = async () => {
    setLoading(true);
    try {
      // Cookie 確認 (開発時のみログ出す場合は各自のローカルで出力してください)
      
      const res = await fetch(`/api/threads-accounts`, { credentials: "include" });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error("[DEBUG] API Error Response:", errorData);
        throw new Error(`API Error: ${res.status} ${res.statusText} - ${errorData.message || errorData.error || ''}`);
      }
      
      const data = await res.json();
      // API Response received
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      let accounts = (data.items ?? data.accounts) ?? [];
      // ensure status exists
      accounts = accounts.map((a: any) => ({ ...(a || {}), status: (a && a.status) || 'active' }));
      // If a search filter is present in localStorage (for local testing), apply it
      try {
        const filterId = localStorage.getItem('accounts.filterId') || '';
        if (filterId) accounts = accounts.filter((a: unknown) => {
          const rec = a as { accountId?: unknown; username?: unknown };
          const id = rec.accountId ?? rec.username ?? '';
          return String(id).includes(filterId);
        });
      } catch {}
      // 登録日(createdAt)の降順でソート（新しい順）
      accounts = accounts.sort((a: unknown, b: unknown) => {
        const aa = (a as { createdAt?: number }).createdAt || 0;
        const bb = (b as { createdAt?: number }).createdAt || 0;
        return bb - aa;
      });
      // Parsed accounts prepared
      setAccounts(accounts);
      setCurrentAccountsCount(accounts.length);
    } catch (error) {
        // debug error removed
      const message = error instanceof Error ? error.message : String(error);
      alert(`アカウント読み込みに失敗しました: ${message}`);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  };

  // 初回マウント時のみAPI取得
  useEffect(() => {
    loadAccounts();
  }, []);

  // ユーザー設定からアプリ列表示フラグを取得
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/user-settings', { credentials: 'include', cache: 'no-store' });
          if (r.ok) {
          const j = await r.json();
          const s = j?.settings || j || {};
          setShowAppColumn(!!s.enableAppColumn);
          // store maxThreadsAllowed for display
          const max = typeof s.maxThreadsAccounts === 'number' ? s.maxThreadsAccounts : Number(s.maxThreadsAccounts || 0);
          setMaxThreadsAllowed(isNaN(max) ? null : max);
          // 新規作成制御: maxThreadsAccounts が存在する場合は利用状況をチェック
          try {
            const max = typeof s.maxThreadsAccounts === 'number' ? s.maxThreadsAccounts : Number(s.maxThreadsAccounts || 0);
            if (typeof max === 'number') {
              if (max === 0) {
                setCanCreateAccount(false);
              } else {
                // count current accounts
                try {
                  const qc = await fetch('/api/threads-accounts', { credentials: 'include' });
                    if (qc.ok) {
                    const data = await qc.json();
                    const items = data.items || data.accounts || [];
                    const count = Array.isArray(items) ? items.length : 0;
                    setCurrentAccountsCount(count);
                    setCanCreateAccount(count < max);
                  }
                } catch (e) {
                  // ignore - keep default true
                }
              }
            }
          } catch (e) {}
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

  // テキストのトリミング（2段階投稿の長文を短縮表示用）
  // maxChars: 一行あたりの最大文字数、maxLines: 表示する最大行数
  const truncate = (text: string, maxChars = 30, maxLines = 2) => {
    if (!text) return "";
    const lines = text.split(/\n/);
    const shown: string[] = [];
    for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
      const line = lines[i];
      shown.push(line.length > maxChars ? `${line.slice(0, maxChars)}…` : line);
    }
    // 複数行を結合して残りがある場合は省略記号で示す
    if (lines.length > maxLines) {
      return shown.join("\n") + "…";
    }
    return shown.join("\n");
  };

  // 楽観的UIトグル（対象はブール値のみ）
  const handleToggle = async (
    acc: ThreadsAccount,
    field: "autoPost" | "autoGenerate" | "autoReply" // ←型を限定
  ) => {
    if (updatingId) return; // [ADD] 同時更新ガード
    const newVal = !acc[field];
    const prevVal = acc[field]; // [ADD] ロールバック用に保持
    setUpdatingId(acc.accountId); // [ADD]

    // 楽観更新
    setAccounts((prev) =>
      prev.map((a) => (a.accountId === acc.accountId ? { ...a, [field]: newVal } : a))
    );

    try {
      // [FIX] サーバー側の期待に合わせてトップレベルにブール値を渡す
      const payload: Record<string, unknown> = { accountId: acc.accountId, [field]: newVal };
      const resp = await fetch("/api/threads-accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        throw new Error(await resp.text());
      }
      // 成功時はサーバー値で再同期（ズレ防止）
      await loadAccounts(); // [ADD]
    } catch (e) {
      console.error(e);
      // [ADD] 失敗時はロールバック
      setAccounts((prev) =>
        prev.map((a) => (a.accountId === acc.accountId ? { ...a, [field]: prevVal } : a))
      );
      alert("更新に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setUpdatingId(null); // [ADD]
    }
  };

  const handleAddClick = () => {
    setModalMode("create");
    setSelectedAccount(null);
    setModalOpen(true);
  };

  const handleEditClick = (account: ThreadsAccount) => {
    setModalMode("edit");
    setSelectedAccount(account);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    // prevent full page reload when modal closes during delete flow
    // keep focus and avoid navigation side-effects
    try { window.history.replaceState({}, document.title, window.location.pathname); } catch (e) {}
  };

  // [DEL] 一覧上の削除ボタンは廃止。モーダル側に移設しました。
  // const handleDelete = async (acc: ThreadsAccount) => { ... }

  const handleOpenInApp = (acc: ThreadsAccount) => {
    const username = String(acc.accountId || "").replace(/^@/, "");
    const threadsUrl = `https://www.threads.net/@${encodeURIComponent(username)}`;
    const containerName = encodeURIComponent(username);
    const deepLink = `mycontainers://open?name=${containerName}&url=${encodeURIComponent(threadsUrl)}`;
    try {
      window.location.href = deepLink;
    } catch (e) {
      console.error("failed to open mycontainers link", e);
      alert("アプリ起動用のURLを開けませんでした。");
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8">読み込み中...</div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto mt-10">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">アカウント一覧</h1>
          {typeof maxThreadsAllowed === 'number' && (
            <span className="text-sm text-gray-500">(アカウント追加可能数：{Math.max(0, (maxThreadsAllowed || 0) - currentAccountsCount)})</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            className="bg-blue-500 text-white rounded px-4 py-2 hover:bg-blue-600"
            onClick={loadAccounts}
            disabled={loading}
          >
            {loading ? "読み込み中..." : "再読み込み"}
          </button>
          <button
            className={`bg-green-500 text-white rounded px-4 py-2 hover:bg-green-600 ${!canCreateAccount ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={handleAddClick}
            disabled={!canCreateAccount}
            title={!canCreateAccount ? 'アカウント作成の上限に達しているため追加できません' : undefined}
          >
            ＋新規追加
          </button>
        </div>
      </div>
      <table className="w-full border shadow bg-white dark:bg-gray-900 rounded overflow-hidden">
        <thead className="bg-gray-100 dark:bg-gray-800">
          <tr>
            {/* [MOD] アカウント名列を広く */}
            <th className="py-2 px-3 min-w-[16rem] w-64 text-left">アカウント名</th>
            <th className="py-2 px-3 w-44 text-left">ID</th>
            <th className="py-2 px-3 w-36">登録日</th>
            <th className="py-2 px-3 w-28">自動投稿</th>
            <th className="py-2 px-3 w-28">本文生成</th>
            <th className="py-2 px-3 w-28">リプ返信</th>
            <th className="py-2 px-3 w-36">状態</th>
            {/* ▼追加カラム：2段階投稿の有無／冒頭プレビュー */}
            <th className="py-2 px-3 w-52 text-left">2段階投稿</th>
            {showAppColumn && <th className="py-2 px-3 w-40">アプリ</th>}
            {/* [DEL] 操作列（編集/削除）は廃止 */}
          </tr>
        </thead>
        <tbody>
          {accounts.map((acc) => (
            <tr key={acc.accountId} className="text-center border-t">
              {/* [MOD] クリックで編集モーダルを開く */}
              <td className="py-2 px-3 text-left">
                {acc.status === 'deleting' ? (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-700">{acc.displayName}</span>
                    <span className="inline-block bg-red-600 text-white text-xs px-2 py-0.5 rounded">削除中</span>
                  </div>
                ) : (
                  <button
                    className="text-blue-600 hover:underline"
                    onClick={() => handleEditClick(acc)}
                  >
                    {acc.displayName}
                  </button>
                )}
              </td>
              <td className="py-2 px-3 text-left">{acc.accountId}</td>
              <td className="py-2 px-3">
                {acc.createdAt ? new Date(acc.createdAt * 1000).toLocaleString() : ""}
              </td>
                <td className="py-2 px-3">
                <ToggleSwitch
                  checked={!!acc.autoPost}
                  onChange={() => handleToggle(acc, "autoPost")}
                  disabled={updatingId === acc.accountId || acc.status === 'deleting'}
                />
              </td>
              <td className="py-2 px-3">
                <ToggleSwitch
                  checked={!!acc.autoGenerate}
                  onChange={() => handleToggle(acc, "autoGenerate")}
                  disabled={updatingId === acc.accountId}
                />
              </td>
              <td className="py-2 px-3">
                <div className="flex items-center gap-2">
                  <ToggleSwitch
                    checked={!!acc.autoReply}
                    onChange={() => handleToggle(acc, "autoReply")}
                    disabled={updatingId === acc.accountId}
                  />
                  {!acc.autoReply && (
                    <span className="text-xs text-red-600" title="リプライ自動返信がオフです">⚠️</span>
                  )}
                </div>
              </td>
              <td className="py-2 px-3">
                {/* 削除キュー中は赤バッジを押下可能にしてキャンセルを実行 */}
                {acc.status === 'deleting' ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="inline-block bg-red-600 text-white text-xs px-2 py-0.5 rounded hover:opacity-80 whitespace-nowrap"
                      onClick={async () => {
                        if (!confirm('削除を中止しますか？')) return;
                        try {
                          const r = await fetch(`/api/accounts/${encodeURIComponent(acc.accountId)}/cancel-deletion`, { method: 'POST', credentials: 'include' });
                          if (!r.ok) {
                            const t = await r.text().catch(() => '');
                            alert('中止に失敗しました: ' + t);
                            return;
                          }
                          alert('削除を中止しました');
                          try { await loadAccounts(); } catch (e) { console.warn(e); }
                        } catch (e) {
                          alert('中止に失敗しました: ' + String(e));
                        }
                      }}
                    >削除中</button>
                    <span className="text-sm text-gray-700">{acc.statusMessage || ''}</span>
                  </div>
                ) : (
                  acc.statusMessage || ""
                )}
              </td>
              <td className="py-2 px-3 text-left">
                {acc.secondStageContent && acc.secondStageContent.trim().length > 0
                  ? (
                      <div className="text-sm" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'normal' }}>
                        {truncate(acc.secondStageContent, 30, 2)}
                      </div>
                    )
                  : "—"}
              </td>
              {showAppColumn && (
                <td className="py-2 px-3">
                <div className="flex items-center justify-center">
                    <div className="flex items-center justify-center">
                    <button
                      className={`bg-indigo-500 text-white rounded px-3 py-1 whitespace-nowrap hover:bg-indigo-600`}
                        onClick={() => handleOpenInApp(acc)}
                        title="アプリ"
                      >
                        アプリ
                      </button>
                    </div>
                  </div>
                </td>
              )}
              {/* [DEL] 一覧の編集/削除ボタンは廃止 */}
            </tr>
          ))}
        </tbody>
      </table>

      {/* モーダル表示 */}
      <SNSAccountModal
        open={modalOpen}
        onClose={handleCloseModal}
        mode={modalMode}
        account={selectedAccount}
        reloadAccounts={loadAccounts}
      />
    </div>
  );
}
