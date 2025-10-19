"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import AdminGuard from "@/components/AdminGuard";

type Token = {
  token_id: string;
  remaining_quota: number;
  expires_at?: number | null;
  disabled: boolean;
  bound_device_id?: string | null;
  updated_at?: number | null;
  username?: string | null;
};

export default function TokenManagementPage() {
  const router = useRouter();
  const DASHBOARD_PATH = "/dashboard";

  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [size] = useState(50);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState<null | Token>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);

  useEffect(() => {
    fetchTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function fetchTokens() {
    setLoading(true);
    try {
      const q = search ? `&query=${encodeURIComponent(search)}` : "";
      const res = await fetch(`/api/admin/tokens?page=${page}&size=${size}${q}`);
      if (!res.ok) throw new Error(await res.text());
      const body = await res.json();
      setTokens(body.items || []);
    } catch (err: any) {
      console.error(err);
      setMessage("トークン取得に失敗しました");
      // 403 の可能性がある場合はダッシュボードへ
      if (err?.message?.includes("403") || err?.status === 403) {
        router.replace(DASHBOARD_PATH);
      }
    } finally {
      setLoading(false);
    }
  }

  function formatDate(epoch?: number | null) {
    if (!epoch) return "-";
    const d = new Date(epoch * 1000);
    return d.toLocaleString();
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTokenId(text);
      setTimeout(() => setCopiedTokenId(null), 2000);
      setMessage("token をクリップボードにコピーしました");
    } catch (err) {
      console.error("copy failed", err);
      setMessage("コピーに失敗しました");
    }
  }

  async function handleCreate(form: any) {
    try {
      const payload: any = {
        remaining_quota: Number(form.remaining_quota),
      };
      if (form.expires_at) payload.expires_at = Math.floor(new Date(form.expires_at).getTime() / 1000);
      if (form.metadata) payload.metadata = JSON.parse(form.metadata);
      if (form.token_plain) payload.token_plain = form.token_plain;

      const res = await fetch("/api/admin/tokens/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "create failed");
      setMessage("トークンを作成しました。平文は一度だけ表示されます。");
      if (data.token_plain) alert(`平文トークン: ${data.token_plain}`);
      setShowCreate(false);
      fetchTokens();
    } catch (err: any) {
      console.error(err);
      setMessage("トークン作成に失敗しました");
    }
  }

  async function handleUpdate(token_id: string, updates: any) {
    try {
      const payload = { token_id, ...updates };
      const res = await fetch("/api/admin/tokens/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("更新しました");
      setShowEdit(null);
      fetchTokens();
    } catch (err: any) {
      console.error(err);
      setMessage("更新に失敗しました");
    }
  }

  async function handleInvalidate(token_id: string, action: "disable" | "clear_binding") {
    if (!confirm(`${action === "disable" ? "無効化" : "バインド解除"}しますか？`)) return;
    try {
      const res = await fetch("/api/admin/tokens/invalidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token_id, action }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("操作を実行しました");
      fetchTokens();
    } catch (err: any) {
      console.error(err);
      setMessage("操作に失敗しました");
    }
  }

  return (
    <AdminGuard redirectTo={DASHBOARD_PATH}>
      <AppLayout>
        <div className="p-6 max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">トークン管理</h1>

          <div className="flex gap-3 mb-3 items-center">
            <input
              className="border rounded px-3 py-2 flex-1"
              placeholder="token_id / plan / bound_device_id で検索"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex gap-2">
              <button className="px-4 py-2 rounded bg-indigo-600 text-white" onClick={() => fetchTokens()}>
                再読込
              </button>
              <button className="px-4 py-2 rounded bg-indigo-600 text-white/90" onClick={() => setShowCreate(true)}>
                新規作成
              </button>
            </div>
          </div>

          {message && <div className="mb-3 text-red-600 text-sm break-all">{message}</div>}

          <div className="overflow-x-auto bg-white border rounded">
            <table className="min-w-full text-sm">
              <colgroup>
                <col style={{ width: '12%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '20%' }} />
              </colgroup>
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left">トークン</th>
                  <th className="px-3 py-2 text-left">Username</th>
                  <th className="px-3 py-2 text-left">使用可能数</th>
                  <th className="px-3 py-2 text-left">expires_at</th>
                  <th className="px-3 py-2 text-left">disabled</th>
                  <th className="px-3 py-2 text-left">デバイス</th>
                  <th className="px-3 py-2 text-left">最終使用日</th>
                  <th className="px-3 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-gray-500">読み込み中…</td>
                  </tr>
                ) : tokens.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-gray-500">該当するデータがありません</td>
                  </tr>
                ) : (
                  tokens.map((t) => (
                  <tr key={t.token_id} className="border-t">
                      <td className="px-3 py-2">
                        <div className="cell-content">
                          <button className="text-indigo-600 font-medium hover:underline nowrap-button" onClick={() => copyToClipboard(t.token_id)}>
                            {t.token_id.slice(0, 4)}...{t.token_id.slice(-4)}
                          </button>
                          {copiedTokenId === t.token_id && <span className="ml-2 text-sm text-green-600">コピーしました</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2">{t.username || "-"}</td>
                      <td className="px-3 py-2">{t.remaining_quota}</td>
                      <td className="px-3 py-2">{formatDate(t.expires_at)}</td>
                      <td className="px-3 py-2">{t.disabled ? "無効" : "有効"}</td>
                      <td className="px-3 py-2">{(t.bound_device_id || "-").toString().slice(0,8)}</td>
                      <td className="px-3 py-2">{formatDate(t.updated_at)}</td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex gap-2 justify-end">
                          <button className="px-3 py-2 rounded bg-gray-200" onClick={() => setShowEdit(t)}>編集</button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex justify-between">
            <div>
              <button className="px-4 py-2 rounded bg-gray-200" onClick={() => { setPage((p) => Math.max(1, p - 1)); }}>前へ</button>
              <button className="px-4 py-2 rounded bg-gray-200 ml-2" onClick={() => { setPage((p) => p + 1); }}>次へ</button>
            </div>
          </div>

          {/* Create Modal */}
          {showCreate && (
            <div className="fixed inset-0 z-50">
              <div className="absolute inset-0 bg-black/40" onClick={() => setShowCreate(false)} />
              <div className="absolute inset-0 p-4 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold">トークン作成</h3>
                    <button className="text-gray-500 hover:text-gray-800 text-xl" onClick={() => setShowCreate(false)}>×</button>
                  </div>
                  <CreateTokenForm onCancel={() => setShowCreate(false)} onSubmit={handleCreate} />
                </div>
              </div>
            </div>
          )}

          {/* Edit Modal */}
          {showEdit && (
            <div className="fixed inset-0 z-50">
              <div className="absolute inset-0 bg-black/40" onClick={() => setShowEdit(null)} />
              <div className="absolute inset-0 p-4 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold">トークン編集</h3>
                    <button className="text-gray-500 hover:text-gray-800 text-xl" onClick={() => setShowEdit(null)}>×</button>
                  </div>
                  <EditTokenForm token={showEdit} onCancel={() => setShowEdit(null)} onSubmit={(updates) => handleUpdate(showEdit.token_id, updates)} />
                </div>
              </div>
            </div>
          )}
        </div>
      </AppLayout>
    </AdminGuard>
  );
}

function CreateTokenForm({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (data: any) => void }) {
  const [remaining_quota, setRemainingQuota] = useState(1);
  const [expires_at, setExpiresAt] = useState<string>("");
  const [metadata, setMetadata] = useState<string>('{"plan":"pro"}');
  const [token_plain, setTokenPlain] = useState<string>("");

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        onSubmit({ remaining_quota, expires_at, metadata, token_plain });
      }}
    >
      <div className="mb-2">
        <label className="block text-sm">remaining_quota</label>
        <input type="number" className="border p-2 w-full" value={remaining_quota} min={1} onChange={e => setRemainingQuota(Number(e.target.value))} />
      </div>
      <div className="mb-2">
        <label className="block text-sm">expires_at (datetime-local)</label>
        <input type="datetime-local" className="border p-2 w-full" value={expires_at} onChange={e => setExpiresAt(e.target.value)} />
      </div>
      <div className="mb-2">
        <label className="block text-sm">metadata (JSON)</label>
        <textarea className="border p-2 w-full" rows={4} value={metadata} onChange={e => setMetadata(e.target.value)} />
      </div>
      <div className="mb-4">
        <label className="block text-sm">token_plain (任意)</label>
        <input className="border p-2 w-full" value={token_plain} onChange={e => setTokenPlain(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel}>キャンセル</button>
        <button type="submit" className="btn btn-primary">作成</button>
      </div>
    </form>
  );
}

function EditTokenForm({ token, onCancel, onSubmit }: { token: Token; onCancel: () => void; onSubmit: (updates: any) => void }) {
  const [remaining_quota, setRemainingQuota] = useState<number>(token.remaining_quota);
  const [expires_at, setExpiresAt] = useState<string>(token.expires_at ? new Date(token.expires_at * 1000).toISOString().slice(0, 16) : "");
  const [disabled, setDisabled] = useState<boolean>(token.disabled);
  const [username, setUsername] = useState<string>("");

  useEffect(() => {
    // try to read username if available
    // @ts-ignore
    setUsername(token['username'] || "");
  }, [token]);

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        onSubmit({ remaining_quota, expires_at: expires_at ? Math.floor(new Date(expires_at).getTime() / 1000) : undefined, disabled, username });
      }}
    >
      <div className="mb-2">
        <label className="block text-sm">remaining_quota</label>
        <input type="number" className="border p-2 w-full" value={remaining_quota} min={0} onChange={e => setRemainingQuota(Number(e.target.value))} />
      </div>
      <div className="mb-2">
        <label className="block text-sm">expires_at (datetime-local)</label>
        <input type="datetime-local" className="border p-2 w-full" value={expires_at} onChange={e => setExpiresAt(e.target.value)} />
      </div>
      <div className="mb-2">
        <label className="block font-medium mb-1">Username（管理用）</label>
        <input type="text" className="w-full border rounded px-3 py-2" value={username} onChange={e => setUsername(e.target.value)} />
      </div>
      <div className="mb-4">
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={disabled} onChange={e => setDisabled(e.target.checked)} /> 無効化</label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel}>キャンセル</button>
        <button type="submit" className="btn btn-primary">更新</button>
        <button type="button" className="px-4 py-2 rounded bg-gray-200 ml-2" onClick={async () => {
          if (!confirm("バインドを解除しますか？")) return;
          try {
            const res = await fetch('/api/admin/tokens/invalidate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token_id: token.token_id, action: 'clear_binding' }) });
            if (!res.ok) throw new Error(await res.text());
            onCancel();
            location.reload();
          } catch (e) {
            alert('バインド解除に失敗しました');
          }
        }}>バインド解除</button>

        <button type="button" className="px-4 py-2 rounded bg-gray-200 ml-2" onClick={async () => {
          if (!confirm("無効化しますか？")) return;
          try {
            const res = await fetch('/api/admin/tokens/invalidate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token_id: token.token_id, action: 'disable' }) });
            if (!res.ok) throw new Error(await res.text());
            onCancel();
            location.reload();
          } catch (e) {
            alert('無効化に失敗しました');
          }
        }}>無効化</button>

        <button type="button" className="px-4 py-2 rounded bg-red-600 text-white ml-2" onClick={async () => {
          if (!confirm("本当に削除しますか？この操作は取り消せません。")) return;
          try {
            const res = await fetch('/api/admin/tokens/invalidate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token_id: token.token_id, action: 'delete' }) });
            if (!res.ok) throw new Error(await res.text());
            onCancel();
            location.reload();
          } catch (e) {
            alert('削除に失敗しました');
          }
        }}>削除</button>
      </div>
    </form>
  );
}


