"use client";
import React, { useState, useEffect } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  mode?: "create" | "edit";
  account?: any;
  reload?: () => void;
};

type PropsExt = Props & { defaultType?: 'general' | 'ero' | 'saikyou' };

export default function XAccountModal({ open, onClose, mode = "create", account, reload, defaultType }: PropsExt) {
  const [displayName, setDisplayName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [masked, setMasked] = useState(false);
  const [authState, setAuthState] = useState("");
  const [oauthAccessTokenLocal, setOauthAccessTokenLocal] = useState<string>('');
  const [checkingAuth, setCheckingAuth] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accountType, setAccountType] = useState<'general' | 'ero' | 'saikyou'>('general');

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && account) {
      setDisplayName(account.displayName || account.username || "");
      setAccountId(account.accountId || account.providerUserId || "");
      // Try to fetch latest full account record (may contain clientId)
      (async () => {
        try {
          const acctId = account.accountId || account.providerUserId || '';
          if (acctId) {
            const resp = await fetch(`/api/x-accounts?accountId=${encodeURIComponent(acctId)}`, { credentials: 'include' });
            if (resp.ok) {
              const j = await resp.json().catch(() => ({}));
              const full = j.account || {};
              setClientId(full.clientId || account.clientId || "");
              // indicate whether secret exists
              setMasked(!!(full.clientSecret || account.hasClientSecret || false));
              setOauthAccessTokenLocal(full.oauthAccessToken || full.accessToken || '');
            } else {
              setClientId(account.clientId || "");
            }
          } else {
            setClientId(account.clientId || "");
          }
        } catch (e) {
          setClientId(account.clientId || "");
        }
      })();
      setMasked(!!account.hasClientSecret);
      setClientSecret("");
      setAuthState(account.authState || account.status || "");
      setAccountType((account.type as any) || 'general');
    } else {
      setDisplayName(""); setAccountId(""); setClientId(""); setClientSecret(""); setMasked(false); setAuthState("");
      // when creating, default type is provided by parent (e.g., list context)
      setAccountType((defaultType as any) || 'general');
    }
  }, [open, mode, account]);

  if (!open) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const method = mode === "create" ? "POST" : "PUT";
      const body: any = { accountId, username: displayName, clientId, type: accountType };
      if (!masked && clientSecret) body.clientSecret = clientSecret;
      const res = await fetch('/api/x-accounts', { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await res.text());
      if (reload) reload();
      onClose();
    } catch (e) {
      alert('保存に失敗しました: ' + String(e));
    } finally { setSaving(false); }
  };

  const handleCopyAuthUrl = async () => {
    try {
      const r = await fetch(`/api/x/authorize?accountId=${encodeURIComponent(accountId)}&raw=1`, { credentials: 'include' });
      // If response is JSON with auth_url, use it. Otherwise fail loudly so caller doesn't get a relative fallback URL.
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        throw new Error(`認可URL取得エラー: HTTP ${r.status} ${txt}`);
      }
      const j = await r.json().catch(() => ({}));
      const url = j.auth_url || '';
      if (!url) throw new Error('認可URLが返却されませんでした');
      try { await navigator.clipboard.writeText(url); alert('認可URLをコピーしました'); } catch { alert('クリップボードへコピーできませんでした: ' + url); }
    } catch (e) { alert('認可URL取得に失敗しました: ' + String(e)); }
  };

  const handleOpenApp = () => {
    try { const name = String(accountId || '').replace(/^@/, ''); const url = `https://x.com/${encodeURIComponent(name)}`; window.location.href = `mycontainers://open?name=${encodeURIComponent(name)}&url=${encodeURIComponent(url)}`; } catch (e) {}
  };

  const handleDelete = async () => {
    if (!accountId) return;
    if (!confirm('アカウントを削除しますか？')) return;
    try {
      const res = await fetch('/api/x-accounts', { method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId }) });
      if (!res.ok) throw new Error(await res.text());
      if (reload) reload();
      onClose();
    } catch (e) { alert('削除に失敗しました: ' + String(e)); }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
      <div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-6 rounded w-[640px]">
        <h3 className="text-lg font-bold mb-4">{mode === 'edit' ? 'アカウント編集 (X)' : 'X アカウント追加'}</h3>
        <form onSubmit={handleSave} autoComplete="off">
          {/* hidden fields to reduce browser autofill */}
          <input type="text" name="prevent_autofill_username" autoComplete="username" className="hidden" />
          <input type="password" name="prevent_autofill_password" autoComplete="new-password" className="hidden" />
          <label className="block">アカウント名</label>
          <input name="displayName" autoComplete="off" className="mb-2 border rounded px-2 py-1 w-full" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <label className="block">ID</label>
          <input
            name="accountId"
            autoComplete="off"
            className="mb-2 border rounded px-2 py-1 w-full"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            disabled={mode === 'edit'}
          />
          <label className="block">clientId</label>
          <input name="clientId" autoComplete="off" className="mb-2 border rounded px-2 py-1 w-full" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          <label className="block">clientSecret</label>
          {masked ? (
            <div className="flex gap-2 items-center mb-2">
              <input readOnly name="clientSecretMasked" autoComplete="new-password" value={'********'} className="flex-1 border rounded px-2 py-1 bg-gray-50 dark:bg-gray-800 dark:text-gray-100" />
              <button type="button" className="px-2 py-1 border rounded bg-gray-100 dark:bg-gray-800 dark:text-gray-100" onClick={() => { setMasked(false); setClientSecret(''); }}>変更</button>
            </div>
          ) : (
            <input type="password" name="clientSecret" autoComplete="new-password" className="mb-2 border rounded px-2 py-1 w-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
          )}

          <div className="flex items-center gap-2 mb-4">
            <button type="button" className="bg-yellow-500 dark:bg-yellow-500 text-white px-3 py-1 rounded" onClick={handleCopyAuthUrl}>認可URLコピー</button>
            <button
              type="button"
              aria-label={oauthAccessTokenLocal ? '認証解除' : '未認証'}
              title={oauthAccessTokenLocal ? '認証解除' : '未認証'}
              className={`${oauthAccessTokenLocal ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-red-600 text-white'} rounded-full px-3 py-1 text-xs`}
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (oauthAccessTokenLocal) {
                  if (!accountId) return;
                  if (!confirm('認証を解除します。よろしいですか？（DBからトークンを削除します）')) return;
                  try {
                    const res = await fetch('/api/x-accounts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ accountId, oauthAccessToken: '' }) });
                    const d = await res.json().catch(() => ({}));
                    if (!res.ok || d?.error) throw new Error(d?.error || 'deauth failed');
                    setOauthAccessTokenLocal('');
                    if (reload) reload();
                  } catch (err: any) { alert('解除に失敗しました: ' + (err?.message || err)); }
                  return;
                }
                // No token: perform async check without causing navigation/reload
                setCheckingAuth(true);
                try {
                  const acctId = accountId;
                  if (!acctId) return;
                  const resp = await fetch(`/api/x-accounts?accountId=${encodeURIComponent(acctId)}`, { credentials: 'include', cache: 'no-store' });
                  if (resp.ok) {
                    const json = await resp.json().catch(() => ({}));
                    const tok = (json?.account && (json.account.oauthAccessToken || json.account.accessToken)) || '';
                    setOauthAccessTokenLocal(tok || '');
                  }
                } catch (e) {
                  // ignore
                } finally { setCheckingAuth(false); }
              }}
            >
              {checkingAuth ? '確認中...' : (oauthAccessTokenLocal ? '認証済み' : '未認証')}
            </button>
            {/* copy callback url button next to auth status */}
            <button
              type="button"
              aria-label="コールバックURLコピー"
              title="コールバックURLをコピー"
              className="ml-2 px-2 py-1 border rounded text-sm bg-gray-50 dark:bg-gray-800"
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const cb = 'https://threadsbooster.jp/api/x/callback';
                try { await navigator.clipboard.writeText(cb); alert('コールバックURLをコピーしました'); } catch { alert('クリップボードへコピーできませんでした: ' + cb); }
              }}
            >
              コールバックコピー
            </button>
            <button type="button" className="ml-auto bg-indigo-500 dark:bg-indigo-600 text-white px-3 py-1 rounded" onClick={handleOpenApp}>アプリ</button>
          </div>

          <div className="flex justify-between">
            <div>
            {mode === 'edit' && (
              <>
                <button type="button" className="bg-red-600 text-white px-3 py-1 rounded" onClick={handleDelete}>削除</button>
              </>
            )}
            </div>
            <div className="flex gap-2">
              <button type="button" className="px-3 py-1 border rounded" onClick={onClose}>キャンセル</button>
              <button type="submit" className="bg-blue-500 text-white px-4 py-1 rounded" disabled={saving}>{saving ? '保存中...' : '保存'}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}


