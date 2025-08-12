// /src/app/admin/users/page.tsx
// 管理者専用ユーザー一覧画面（Tailwindのみ）
"use client";

import React, { useEffect, useMemo, useState } from "react";
import ToggleSwitch from "@/components/ToggleSwitch";
// 画面表示のため、フロントでは「見せる/隠す」判定のみ。サーバのAPI側で必ずadmin検証します。

type AdminUserRow = {
  userId: string;
  email: string;
  planType: string;
  apiDailyLimit: number;
  apiUsedCount: number;
  autoPostAdminStop: boolean;
  autoPost: boolean; // UserSettings.autoPost
  updatedAt: number;
};

export default function AdminUsersPage() {
  const [items, setItems] = useState<AdminUserRow[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!q.trim()) return items;
    const k = q.toLowerCase();
    return items.filter((r) => (r.email || "").toLowerCase().includes(k) || (r.userId || "").toLowerCase().includes(k));
  }, [items, q]);

  async function fetchList() {
    setLoading(true);
    setErr(null);
    try {
      const resp = await fetch("/api/admin/users", { headers: { "Content-Type": "application/json" } });
      if (!resp.ok) throw new Error(await resp.text());
      const json = await resp.json();
      setItems(json.items || []);
    } catch (e: any) {
      setErr(e?.message || "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchList();
  }, []);

  const onChangeField = (userId: string, patch: Partial<AdminUserRow>) => {
    setItems((prev) => prev.map((r) => (r.userId === userId ? { ...r, ...patch } : r)));
  };

  const onSave = async (row: AdminUserRow) => {
    setSaving(row.userId);
    setErr(null);
    try {
      const body = {
        apiDailyLimit: row.apiDailyLimit,
        autoPostAdminStop: row.autoPostAdminStop,
        autoPost: row.autoPost,
      };
      const resp = await fetch(`/api/admin/users/${row.userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(await resp.text());
    } catch (e: any) {
      setErr(e?.message || "保存に失敗しました");
    } finally {
      setSaving(null);
      fetchList();
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">管理者用：ユーザー一覧</h1>

      {/* 検索 */}
      <div className="mb-4 flex items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="email / userId で検索"
          className="border rounded-md px-3 py-2 w-full max-w-md"
        />
        <button onClick={fetchList} className="px-4 py-2 rounded-md border hover:bg-gray-50">再読込</button>
      </div>

      {err && <div className="mb-3 text-sm text-red-600">{err}</div>}
      {loading ? (
        <div className="text-gray-500">読み込み中...</div>
      ) : (
        <div className="overflow-x-auto border rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
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
              {filtered.map((r) => {
                const disabledByAdmin = r.autoPostAdminStop;
                return (
                  <tr key={r.userId} className="border-t">
                    <td className="px-3 py-2">{r.email || <span className="text-gray-400">(no email)</span>}</td>
                    <td className="px-3 py-2 text-gray-600">{r.userId}</td>
                    <td className="px-3 py-2 text-center">{r.planType}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-700">{r.apiUsedCount}</span>
                        <span className="text-gray-400">/</span>
                        <input
                          type="number"
                          min={0}
                          value={r.apiDailyLimit}
                          onChange={(e) => onChangeField(r.userId, { apiDailyLimit: Number(e.target.value || 0) })}
                          className="w-24 border rounded px-2 py-1"
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <ToggleSwitch
                        checked={r.autoPostAdminStop}
                        onChange={(v: boolean) => onChangeField(r.userId, { autoPostAdminStop: v })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <ToggleSwitch
                        checked={!disabledByAdmin && r.autoPost}
                        onChange={(v: boolean) => onChangeField(r.userId, { autoPost: v })}
                        disabled={disabledByAdmin}
                      />
                      {disabledByAdmin && <div className="text-xs text-gray-400 mt-1">管理停止中のため編集不可</div>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => onSave(r)}
                        disabled={saving === r.userId}
                        className="px-3 py-1 rounded-md border hover:bg-gray-50 disabled:opacity-60"
                      >
                        {saving === r.userId ? "保存中..." : "保存"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-gray-500" colSpan={7}>該当するユーザーがいません</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
