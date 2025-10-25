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
  const [extraPosts, setExtraPosts] = useState<Array<{ scheduledAt: string; content: string }>>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>('2投稿');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (post) {
      setAccountId(post.accountId || '');
      setScheduledAt(post.scheduledAt ? new Date(post.scheduledAt * 1000).toISOString().slice(0,16) : formatLocalDatetime(new Date()));
      setContent(post.content || '');
      setExtraPosts([]);
    } else {
      setAccountId('');
      setScheduledAt(formatLocalDatetime(new Date()));
      setContent('');
      setExtraPosts([]);
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
    setErrorMsg(null);
    setSaving(true);
    try {
      // Validation
      // If there are extraPosts, skip main entry when main content empty
      if (extraPosts.length > 0) {
        // validate extraPosts entries: scheduledAt and content must be present
        for (let i = 0; i < extraPosts.length; i++) {
          const p = extraPosts[i];
          if (!p.scheduledAt || String(p.scheduledAt).trim() === '') {
            setErrorMsg('追加予約投稿に日時が未入力の項目があります');
            setSaving(false);
            return;
          }
          if (!p.content || String(p.content).trim() === '') {
            setErrorMsg('追加予約投稿に本文が未入力の項目があります');
            setSaving(false);
            return;
          }
        }
      } else {
        // no extraPosts: main content required
        if (!content || String(content).trim() === '') {
          setErrorMsg('本文を入力してください');
          setSaving(false);
          return;
        }
      }

      // collect main and extra posts
      const toCreate: Array<{accountId:string, content:string, scheduledAt:number}> = [];
      if (extraPosts.length === 0) {
        // no extras -> require main
        if (scheduledAt) toCreate.push({ accountId, content, scheduledAt: Math.floor(new Date(scheduledAt).getTime()/1000) });
      } else {
        // extras exist -> include extras only; if main has content, also include it
        if (content && String(content).trim() !== '' && scheduledAt) {
          toCreate.push({ accountId, content, scheduledAt: Math.floor(new Date(scheduledAt).getTime()/1000) });
        }
        for (const ex of extraPosts) {
          toCreate.push({ accountId, content: ex.content || '', scheduledAt: Math.floor(new Date(ex.scheduledAt).getTime()/1000) });
        }
      }

      const failures: string[] = [];
      // serial POST
      for (const item of toCreate) {
        try {
          const res = await fetch('/api/x-scheduled-posts', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
          if (!res.ok) {
            const txt = await res.text().catch(()=>res.statusText);
            failures.push(`${item.scheduledAt}: ${txt}`);
          }
        } catch (err:any) { failures.push(String(err)); }
      }

      if (failures.length > 0) {
        setErrorMsg('一部の投稿の保存に失敗しました:\n' + failures.join('\n'));
        setSaving(false);
        return;
      }

      onClose();
    } catch (e) {
      setErrorMsg('保存に失敗しました: ' + String(e));
    } finally { setSaving(false); }
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

  const pad = (n: number) => String(n).padStart(2, '0');
  const formatLocalDatetime = (d: Date) => {
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    return `${year}-${month}-${day}T${hh}:${mm}`;
  };

  const addDays = (n: number) => {
    // Always base on current time, not the existing scheduledAt
    const base = new Date();
    const dt = new Date(base.getTime() + n * 24 * 3600 * 1000);
    // preserve current hour/minute
    dt.setHours(base.getHours(), base.getMinutes(), base.getSeconds(), base.getMilliseconds());
    setScheduledAt(formatLocalDatetime(dt));
  };

  const GROUPS: Record<string, number[]> = {
    '2投稿': [7, 19],
    '3投稿': [7, 12, 19],
    '4投稿': [7, 12, 17, 19],
  };
  const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

  const addGroupPosts = async (groupKey: string) => {
    // Base on reservation datetime (scheduledAt) next day; if not present, use tomorrow.
    const dateOnly = (d: Date) => `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
    let baseDate: Date;
    try {
      if (scheduledAt) {
        const sa = new Date(scheduledAt);
        baseDate = new Date(sa.getTime() + 24 * 3600 * 1000);
      } else {
        baseDate = new Date(new Date().getTime() + 24 * 3600 * 1000);
      }
    } catch (_) {
      baseDate = new Date(new Date().getTime() + 24 * 3600 * 1000);
    }

    // If local extraPosts already contain entries for the candidate date, advance to next day
    let safety = 0;
    while (extraPosts.some(p => {
      try { return dateOnly(new Date(p.scheduledAt)) === dateOnly(baseDate); } catch { return false; }
    }) && safety < 30) {
      baseDate = new Date(baseDate.getTime() + 24 * 3600 * 1000);
      safety++;
    }

    const hours = GROUPS[groupKey] || [];
    const newEntries: Array<{scheduledAt:string; content:string}> = [];

    for (const h of hours) {
      const dt = new Date(baseDate);
      dt.setHours(h, 0, 0, 0);
      const deltaMin = randInt(-30, 30);
      dt.setMinutes(dt.getMinutes() + deltaMin);
      // ensure date stays on baseDate
      if (dateOnly(dt) !== dateOnly(baseDate)) {
        dt.setFullYear(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
        dt.setHours(h, Math.max(0, Math.min(59, dt.getMinutes())), 0, 0);
      }
      newEntries.push({ scheduledAt: formatLocalDatetime(dt), content: '' });
    }

    setExtraPosts(prev => [...prev, ...newEntries]);
  };

  const removeExtraPost = (idx: number) => setExtraPosts(prev => prev.filter((_,i)=>i!==idx));

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
      <div className="bg-white dark:bg-gray-900 p-6 rounded w-[720px] text-gray-900 dark:text-gray-100">
        <h3 className="text-lg font-bold mb-3">{post ? '予約編集' : '予約作成'}</h3>
        {errorMsg && <div className="mb-3 text-sm text-red-600 whitespace-pre-wrap">{errorMsg}</div>}
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

          <div className="flex flex-wrap gap-2 mb-2">
            {Array.from({ length: 14 }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" className="px-2 py-1 border rounded text-sm" onClick={() => addDays(n)}>{n}日後</button>
            ))}
          </div>
          <label className="block">本文テキスト</label>
          <textarea className="mb-2 border rounded p-2 w-full min-h-[120px]" value={content} onChange={(e) => setContent(e.target.value)} />

          {extraPosts.length > 0 && (
            <div className="mb-2 border rounded p-3 bg-gray-50 dark:bg-gray-800 max-h-64 overflow-auto">
              <div className="mb-2 font-medium">追加予定投稿</div>
              {extraPosts.map((ex, idx) => (
                <div key={idx} className="flex gap-2 items-start mb-2">
                  <input type="datetime-local" className="border rounded px-2 py-1" value={ex.scheduledAt} onChange={(e) => { const v = e.target.value; setExtraPosts(prev => { const copy = [...prev]; copy[idx] = { ...copy[idx], scheduledAt: v }; return copy; }); }} />
                  <input className="border rounded px-2 py-1 flex-1" placeholder="本文(任意)" value={ex.content} onChange={(e) => { const v = e.target.value; setExtraPosts(prev => { const copy = [...prev]; copy[idx] = { ...copy[idx], content: v }; return copy; }); }} />
                  <button type="button" className="px-2 py-1 border rounded text-sm" onClick={() => removeExtraPost(idx)}>削除</button>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-between items-center gap-2">
            {!post && (
            <div className="flex items-center gap-2">
              <select className="border rounded px-3 py-2" value={selectedGroup} onChange={(e) => setSelectedGroup(e.target.value)} id="group-select">
                <option value="2投稿">2投稿</option>
                <option value="3投稿">3投稿</option>
                <option value="4投稿">4投稿</option>
              </select>
              <button type="button" id="group-add-button" className="ml-2 bg-green-600 text-white rounded px-6 py-2 flex items-center justify-center text-xl min-w-[64px]" onClick={() => addGroupPosts(selectedGroup)}>＋</button>
            </div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="px-3 py-1 border rounded" onClick={onClose}>キャンセル</button>
              <button type="submit" className="bg-blue-500 text-white px-4 py-1 rounded" disabled={saving}>{saving ? '保存中...' : '保存'}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}