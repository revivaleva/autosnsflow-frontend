"use client";
import React, { useState, useEffect } from 'react';

type Props = { open: boolean; onClose: () => void; post?: any };

export default function XPostModal({ open, onClose, post }: Props) {
  const [accountId, setAccountId] = useState('');
  const [accounts, setAccounts] = useState<Array<{ accountId: string; username?: string }>>([]);
  const [theme, setTheme] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (post) {
      setAccountId(post.accountId || '');
      setScheduledAt(post.scheduledAt ? new Date(post.scheduledAt * 1000).toISOString().slice(0,16) : '');
      setContent(post.content || '');
    } else {
      setAccountId(''); setScheduledAt(''); setContent('');
    }
    // load accounts for dropdown
    (async () => {
      try {
        const r = await fetch('/api/x-accounts', { credentials: 'include' });
        if (r.ok) {
          const j = await r.json();
          const items = j.accounts || [];
          const mapped = items.map((it: any) => ({ accountId: it.accountId || (it.SK || '').replace(/^ACCOUNT#/, ''), username: it.username || it.accountName || it.displayName || it.username || '' }));
          setAccounts(mapped);
        }
      } catch (e) {}
    })();
  }, [open, post]);

  if (!open) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body: any = { accountId, content, scheduledAt: Math.floor(new Date(scheduledAt).getTime() / 1000) };
      if (post && post.scheduledPostId) body.scheduledPostId = post.scheduledPostId;
      const method = post ? 'PATCH' : 'POST';
      const res = await fetch('/api/x-scheduled-posts', { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await res.text());
      onClose();
    } catch (e) { alert('保存に失敗しました: ' + String(e)); }
    finally { setSaving(false); }
  };

  const handleAIGenerate = async () => {
    if (!accountId) { alert('アカウントを選択してください'); return; }
    setAiLoading(true);
    try {
      const payload = { purpose: 'post-generate', input: { accountId, theme, prompt: '' } };
      const r = await fetch('/api/ai-gateway', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'AI生成失敗');
      const text = j.text || (j?.personaSimple || '') || '';
      if (text) setContent(String(text));
      else alert('AIから本文が生成されませんでした');
    } catch (e) {
      alert('AI生成エラー: ' + String(e));
    } finally { setAiLoading(false); }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
      <div className="bg-white dark:bg-gray-900 p-6 rounded w-[720px] text-gray-900 dark:text-gray-100">
        <h3 className="text-lg font-bold mb-3">{post ? '予約編集' : '予約作成'}</h3>
        <form onSubmit={handleSave}>
        <label className="block">アカウント</label>
          <select className="mb-2 border rounded px-2 py-1 w-full" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">選択してください</option>
            {accounts.map((a) => (
              <option key={a.accountId} value={a.accountId}>{a.username ? `${a.username} (${a.accountId})` : a.accountId}</option>
            ))}
          </select>
        <label className="block">テーマ</label>
        <div className="flex gap-2 mb-2">
          <input className="flex-1 border rounded px-2 py-1" value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="例: 告知, 雑談" />
          <button type="button" className="bg-gray-100 px-3 py-1 rounded" onClick={handleAIGenerate} disabled={aiLoading}>{aiLoading ? '生成中...' : 'AIで生成'}</button>
        </div>
          <label className="block">予約日時</label>
          <input type="datetime-local" className="mb-2 border rounded px-2 py-1 w-full" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          <label className="block">本文テキスト</label>
          <textarea className="mb-2 border rounded p-2 w-full min-h-[120px]" value={content} onChange={(e) => setContent(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button type="button" className="px-3 py-1 border rounded" onClick={onClose}>キャンセル</button>
            <button type="submit" className="bg-blue-500 text-white px-4 py-1 rounded" disabled={saving}>{saving ? '保存中...' : '保存'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}


