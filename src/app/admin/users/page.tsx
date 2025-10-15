// [MOD] Emailクリックで編集モーダルを開く。背景クリックでキャンセル。
//      管理停止・自動投稿トグル／当日上限を編集 → PATCH /api/admin/users で保存
// [ADD] AdminGuard を巻いて未権限ユーザーをダッシュボードにリダイレクト
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation"; // [ADD]
import AppLayout from "@/components/AppLayout"; // 【追加】
import AdminGuard from "@/components/AdminGuard"; // [ADD] 追加

type AdminUserRow = {
  email: string;
  userId: string;
  username?: string;
  maxThreadsAccounts?: number;
  planType: string;
  apiDailyLimit: number;
  apiUsedCount: number;
  autoPostAdminStop: boolean;
  autoPost: boolean;
  updatedAt: number;
  createdAt?: number;
};

export default function AdminUsersPage() {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  // [DEBUG] 生データ
  const [raw, setRaw] = useState<any>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [showDeferredItems, setShowDeferredItems] = useState(false);

  // [ADD] 非管理者はダッシュボードへリダイレクト
  const router = useRouter();
  const DASHBOARD_PATH = "/dashboard"; // ←環境に合わせて必要なら変更

  // [ADD] 編集モーダル用
  const [editOpen, setEditOpen] = useState(false);
  const [target, setTarget] = useState<AdminUserRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{
    apiDailyLimit: number;
    autoPostAdminStop: boolean;
    autoPost: boolean;
    username: string;
    maxThreadsAccounts: number;
  }>({
    apiDailyLimit: 200,
    autoPostAdminStop: false,
    autoPost: false,
    username: "",
    maxThreadsAccounts: 0,
  });

  // [EDIT] 403(forbidden) を検知したらリダイレクトして終了
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      setRaw(data);

      if (res.status === 403 || data?.error === "forbidden") {
        router.replace(DASHBOARD_PATH);
        return; // 以降のUI更新は不要
      }

      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const list: AdminUserRow[] = (data.items ?? data.users ?? []) as AdminUserRow[];
      setRows(list);
    } catch (e: any) {
      setError(e?.message || "読み込みに失敗しました");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // 初期はローディングだけ実行し、管理用項目は少し遅延させてちらつきを抑止
    load();
    const t = setTimeout(() => setShowDeferredItems(true), 700);
    return () => clearTimeout(t);
  }, []);

  const openEdit = (r: AdminUserRow) => {
    setTarget(r);
    setForm({
      apiDailyLimit: r.apiDailyLimit ?? 200,
      autoPostAdminStop: !!r.autoPostAdminStop,
      autoPost: !!r.autoPost,
      username: r.username ?? "",
      maxThreadsAccounts: r.maxThreadsAccounts ?? 0,
    });
    setEditOpen(true);
  };

  const onBackdrop = () => {
    if (saving) return;
    setEditOpen(false); // 背景クリックでキャンセル
    setTarget(null);
  };

  const onSave = async () => {
    if (!target) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        userId: target.userId,
        apiDailyLimit: Number(form.apiDailyLimit),
        autoPostAdminStop: Boolean(form.autoPostAdminStop),
        autoPost: Boolean(form.autoPost),
        username: String(form.username || ""),
        maxThreadsAccounts: Number(form.maxThreadsAccounts || 0),
      };
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || "更新に失敗しました");
      setEditOpen(false);
      setTarget(null);
      await load(); // 再同期
    } catch (e: any) {
      setError(e?.message || "更新に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const filtered = rows.filter((r) => {
    const key = (q || "").toLowerCase();
    if (!key) return true;
    return (
      r.email?.toLowerCase().includes(key) ||
      r.userId?.toLowerCase().includes(key) ||
      (r.username || "").toLowerCase().includes(key)
    );
  });

  return (
    <AdminGuard redirectTo={DASHBOARD_PATH}>
      <AppLayout>
        <div className="p-6 max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">管理者用：ユーザー一覧</h1>

          <div className="flex gap-3 mb-3">
            <input
              className="border rounded px-3 py-2 w-full"
              placeholder="email / userId / username で検索"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button className="px-4 py-2 rounded bg-indigo-600 text-white nowrap-button w-24" onClick={load}>
              再読込
            </button>
            <button className="px-4 py-2 rounded bg-indigo-600 text-white/90 nowrap-button w-28" onClick={() => setDebugOpen(true)}>
              デバッグ表示
            </button>
          </div>

          {error && <div className="mb-3 text-red-600 text-sm break-all">{error}</div>}

          <div className="overflow-x-auto bg-white dark:bg-gray-900 border rounded">
            <table className="min-w-full text-sm">
              <colgroup>
                <col style={{ width: '30%' }} />
                <col style={{ width: '24%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '3%' }} />
                <col style={{ width: '2%' }} />
                <col style={{ width: '1%' }} />
              </colgroup>
              <thead className="bg-gray-100 dark:bg-gray-800">
                <tr>
                  <th className="px-3 py-2 text-left">Email</th>
                  <th className="px-3 py-2 text-left">UserId</th>
                  <th className="px-3 py-2 text-left">Username</th>
                  <th className="px-3 py-2">Plan</th>
                  <th className="px-3 py-2 text-center">
                    <div>当日使用</div>
                    <div>/ 上限</div>
                  </th>
                  <th className="px-3 py-2">Max Threads</th>
                  <th className="px-3 py-2">管理停止</th>
                  <th className="px-3 py-2">自動投稿（UserSettings）</th>
                  <th className="px-3 py-2">更新</th>
                  <th className="px-3 py-2">作成日</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-6 text-center text-gray-500">
                      読み込み中…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-6 text-center text-gray-500">
                      該当するユーザーがいません
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr key={r.userId} className="border-t">
                      <td className="px-3 py-2">
                        {/* [ADD] Emailクリックで編集モーダル */}
                        <div className="cell-content">
                          <button className="text-indigo-600 font-medium hover:underline nowrap-button" onClick={() => openEdit(r)}>
                            {r.email}
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="cell-content">{r.userId}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="cell-content">{r.username || ""}</div>
                      </td>
                      <td className="px-3 py-2 text-center">{r.planType}</td>
                      <td className="px-3 py-2 text-center">
                        <div>{r.apiUsedCount ?? 0}</div>
                        <div>/ {r.apiDailyLimit}</div>
                      </td>
                      <td className="px-3 py-2 text-center">{r.maxThreadsAccounts ?? 0}</td>
                      <td className="px-3 py-2 text-center">{r.autoPostAdminStop ? "停止" : "—"}</td>
                      <td className="px-3 py-2 text-center">{r.autoPost ? "有効" : "無効"}</td>
                      <td className="px-3 py-2 text-center">
                        {r.updatedAt ? new Date(r.updatedAt * 1000).toLocaleString() : "—"}
                      </td>
                      {/* 登録日（Cognitoの作成日時） */}
                      <td className="px-3 py-2 text-center">
                        {r.createdAt ? new Date(r.createdAt * 1000).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <style jsx>{`
              /* clamp long content only inside .cell-content wrappers to avoid breaking table layout */
              table td { white-space: normal; vertical-align: top; }
              table th { white-space: normal; line-height: 1.2; vertical-align: middle; }
              .nowrap-button { white-space: nowrap; }
              .cell-content {
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
                white-space: normal;
              }
            `}</style>
          </div>

          {/* [DEBUG] 生データのDLG（オーバーレイ順序を [MOD]：先に背景→後に本体） */}
          {debugOpen && (
            <div className="fixed inset-0 z-50">
              {/* 背景（先） */}
              <div className="absolute inset-0 bg-black/40" onClick={() => setDebugOpen(false)} />
              {/* 本体（後） */}
              <div className="absolute inset-0 p-4 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                <div className="bg-white rounded shadow-xl p-4 w-full max-w-3xl">
                  <div className="flex justify-between items-center mb-2">
                    <div className="font-bold">取得レスポンス（生データ）</div>
                    <button className="text-gray-500 hover:text-gray-800" onClick={() => setDebugOpen(false)}>
                      ×
                    </button>
                  </div>
                  <pre className="text-xs whitespace-pre-wrap break-all bg-gray-50 p-3 rounded max-h-[70vh] overflow-auto">
                    {JSON.stringify(raw, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* [ADD] 編集モーダル：背景クリックでキャンセル */}
          {editOpen && target && (
            <div className="fixed inset-0 z-50">
              {/* 背景 */}
              <div className="absolute inset-0 bg-black/40" onClick={onBackdrop} />
              {/* 本体 */}
              <div className="absolute inset-0 flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
                <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold">ユーザー設定を編集</h3>
                    <button className="text-gray-500 hover:text-gray-800 text-xl" onClick={onBackdrop}>
                      ×
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div className="text-sm">
                      <div className="text-gray-600">Email</div>
                      <div className="font-mono break-all">{target.email}</div>
                    </div>

                    <div>
                      <label className="block font-medium mb-1">Username（管理表示名）</label>
                      <input
                        type="text"
                        className="w-full border rounded px-3 py-2"
                        value={form.username}
                        onChange={(e) => setForm((v) => ({ ...v, username: e.target.value }))}
                      />
                      <p className="text-xs text-gray-500 mt-1">管理画面内でのみ表示されます。Cognito には同期しません。</p>
                    </div>

                    <div>
                      <label className="block font-medium mb-1">Max Threads Accounts</label>
                      <input
                        type="number"
                        min={0}
                        className="w-full border rounded px-3 py-2"
                        value={form.maxThreadsAccounts}
                        onChange={(e) => setForm((v) => ({ ...v, maxThreadsAccounts: Number(e.target.value) }))}
                      />
                      <p className="text-xs text-gray-500 mt-1">ユーザーが登録できる Threads アカウント数（デフォルト 0）。</p>
                    </div>

                    <div className="flex items-center justify-between">
                      <label className="font-medium">管理停止</label>
                      <label className="inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          className="sr-only peer"
                          checked={form.autoPostAdminStop}
                          onChange={(e) => setForm((v) => ({ ...v, autoPostAdminStop: e.target.checked }))}
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:bg-blue-600 relative after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:w-5 after:h-5 after:rounded-full after:transition-all peer-checked:after:translate-x-full" />
                      </label>
                    </div>

                    <div className="flex items-center justify-between">
                      <label className="font-medium">自動投稿</label>
                      <label className="inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          className="sr-only peer"
                          checked={form.autoPost}
                          onChange={(e) => setForm((v) => ({ ...v, autoPost: e.target.checked }))}
                        />
                        <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:bg-blue-600 relative after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:w-5 after:h-5 after:rounded-full after:transition-all peer-checked:after:translate-x-full" />
                      </label>
                    </div>

                    <div>
                      <label className="block font-medium mb-1">当日上限</label>
                      <input
                        type="number"
                        min={0}
                        className="w-full border rounded px-3 py-2"
                        value={form.apiDailyLimit}
                        onChange={(e) => setForm((v) => ({ ...v, apiDailyLimit: Number(e.target.value) }))}
                      />
                      <p className="text-xs text-gray-500 mt-1">0以上の整数で入力してください。</p>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 mt-6">
                    <button className="px-4 py-2 rounded bg-gray-200" onClick={onBackdrop} disabled={saving}>
                      キャンセル
                    </button>
                    <button
                      className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
                      onClick={onSave}
                      disabled={saving}
                    >
                      {saving ? "保存中..." : "保存"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </AppLayout>
    </AdminGuard>
  );
}
