// /src/app/admin/users/page.tsx
// [NO-CHANGE or MINOR] 管理者のみで上限編集できる画面（前回提示と同一）
// Tailwindのみ。masterOverride/autoPost/dailyOpenAiLimit/defaultOpenAiCostの更新に対応。

"use client";

import { useEffect, useState } from "react";

type Row = {
  userId: string;
  planType: string;
  autoPost: "active" | "inactive";
  masterOverride: "none" | "forced_off";
  dailyOpenAiLimit: number;
  defaultOpenAiCost: number;
  updatedAt?: number;
};

export default function AdminUsersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      setRows(data.items || []);
    } catch (e: any) {
      setError(e?.message || "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const updateRow = (idx: number, patch: Partial<Row>) => {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  const saveOne = async (r: Row) => {
    setSavingId(r.userId);
    setError("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: r.userId,
          autoPost: r.autoPost,
          masterOverride: r.masterOverride,
          dailyOpenAiLimit: r.dailyOpenAiLimit,
          defaultOpenAiCost: r.defaultOpenAiCost,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t);
      }
      await load();
    } catch (e: any) {
      setError(e?.message || "保存に失敗しました");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold mb-4">管理: ユーザー一覧</h1>

      {error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">読み込み中...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border border-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 border-b text-left">User ID</th>
                <th className="px-3 py-2 border-b text-left">Plan</th>
                <th className="px-3 py-2 border-b text-left">autoPost</th>
                <th className="px-3 py-2 border-b text-left">masterOverride</th>
                <th className="px-3 py-2 border-b text-right">dailyOpenAiLimit</th>
                <th className="px-3 py-2 border-b text-right">defaultOpenAiCost</th>
                <th className="px-3 py-2 border-b text-left">updatedAt</th>
                <th className="px-3 py-2 border-b"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.userId} className="odd:bg-white even:bg-gray-50">
                  <td className="px-3 py-2 border-b font-mono text-xs">{r.userId}</td>
                  <td className="px-3 py-2 border-b">{r.planType}</td>
                  <td className="px-3 py-2 border-b">
                    <select
                      className="rounded border border-gray-300 p-1"
                      value={r.autoPost}
                      onChange={(e) => updateRow(idx, { autoPost: e.target.value as any })}
                    >
                      <option value="active">active</option>
                      <option value="inactive">inactive</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 border-b">
                    <select
                      className="rounded border border-gray-300 p-1"
                      value={r.masterOverride}
                      onChange={(e) => updateRow(idx, { masterOverride: e.target.value as any })}
                    >
                      <option value="none">none</option>
                      <option value="forced_off">forced_off</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 border-b text-right">
                    <input
                      type="number"
                      min={0}
                      className="w-24 rounded border border-gray-300 p-1 text-right"
                      value={r.dailyOpenAiLimit}
                      onChange={(e) =>
                        updateRow(idx, { dailyOpenAiLimit: parseInt(e.target.value || "0", 10) })
                      }
                    />
                  </td>
                  <td className="px-3 py-2 border-b text-right">
                    <input
                      type="number"
                      min={1}
                      className="w-20 rounded border border-gray-300 p-1 text-right"
                      value={r.defaultOpenAiCost}
                      onChange={(e) =>
                        updateRow(idx, { defaultOpenAiCost: parseInt(e.target.value || "1", 10) })
                      }
                    />
                  </td>
                  <td className="px-3 py-2 border-b">
                    {r.updatedAt ? new Date(r.updatedAt * 1000).toLocaleString() : "-"}
                  </td>
                  <td className="px-3 py-2 border-b text-right">
                    <button
                      onClick={() => saveOne(r)}
                      disabled={savingId === r.userId}
                      className="rounded bg-indigo-600 px-3 py-1 text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {savingId === r.userId ? "保存中..." : "保存"}
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-sm text-gray-500">
                    データがありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
