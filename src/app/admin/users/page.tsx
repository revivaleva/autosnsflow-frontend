// /src/app/admin/users/page.tsx
// [MOD] 生レスポンスをDLGで確認できるデバッグUIを追加（他UIは変更なし）
"use client";

import { useEffect, useState } from "react";

type AdminUserRow = {
  email: string;
  userId: string;
  planType: string;
  apiDailyLimit: number;
  apiUsedCount: number;
  autoPostAdminStop: boolean;
  autoPost: boolean;
  updatedAt: number;
};

export default function AdminUsersPage() {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  // [DEBUG] 取得した生データを確認できるよう保持
  const [raw, setRaw] = useState<any>(null);          // [ADD]
  const [debugOpen, setDebugOpen] = useState(false);  // [ADD]

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      setRaw(data); // [DEBUG] 生データ保持
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
    load();
  }, []);

  const filtered = rows.filter((r) => {
    const key = (q || "").toLowerCase();
    if (!key) return true;
    return (
      r.email?.toLowerCase().includes(key) ||
      r.userId?.toLowerCase().includes(key)
    );
  });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">管理者用：ユーザー一覧</h1>

      <div className="flex gap-3 mb-3">
        <input
          className="border rounded px-3 py-2 w-full"
          placeholder="email / userId で検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className="bg-gray-800 text-white px-4 py-2 rounded"
          onClick={load}
        >
          再読込
        </button>

        {/* [DEBUG] 生データ表示トグル */}
        <button
          className="bg-gray-500 text-white px-3 py-2 rounded"
          onClick={() => setDebugOpen(true)}
        >
          デバッグ表示
        </button>
      </div>

      {error && (
        <div className="mb-3 text-red-600 text-sm break-all">
          {error}
        </div>
      )}

      <div className="overflow-x-auto bg-white border rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">UserId</th>
              <th className="px-3 py-2">Plan</th>
              <th className="px-3 py-2">当日使用 / 上限</th>
              <th className="px-3 py-2">管理停止</th>
              <th className="px-3 py-2">自動投稿（UserSettings）</th>
              <th className="px-3 py-2">更新</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">読み込み中…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">該当するユーザーがいません</td></tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.userId} className="border-t">
                  <td className="px-3 py-2">{r.email}</td>
                  <td className="px-3 py-2">{r.userId}</td>
                  <td className="px-3 py-2 text-center">{r.planType}</td>
                  <td className="px-3 py-2 text-center">
                    {r.apiUsedCount} / {r.apiDailyLimit}
                  </td>
                  <td className="px-3 py-2 text-center">{r.autoPostAdminStop ? "停止" : "—"}</td>
                  <td className="px-3 py-2 text-center">{r.autoPost ? "有効" : "無効"}</td>
                  <td className="px-3 py-2 text-center">
                    {r.updatedAt ? new Date(r.updatedAt * 1000).toLocaleString() : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* [DEBUG] 生データのDLG */}
      {debugOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded shadow-xl p-4 w-full max-w-3xl">
            <div className="flex justify-between items-center mb-2">
              <div className="font-bold">取得レスポンス（生データ）</div>
              <button
                className="text-gray-500 hover:text-gray-800"
                onClick={() => setDebugOpen(false)}
              >
                ×
              </button>
            </div>
            <pre className="text-xs whitespace-pre-wrap break-all bg-gray-50 p-3 rounded max-h-[70vh] overflow-auto">
              {JSON.stringify(raw, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
