// src/app/dashboard/page.tsx
// －－－－－－－－－－－－－－－－－－－－－－－－－－－－－－
// 既存ダッシュボードに「要約カード」と「最近のエラー（タブ）」を【追加】
// －－－－－－－－－－－－－－－－－－－－－－－－－－－－－－
'use client';

import React, { useEffect, useMemo, useState } from 'react';

// 【追加】型定義
type DashboardStats = {
  accountCount: number;
  scheduledCount: number;
  todaysPostedCount: number;
  unrepliedCount: number;
  repliedCount: number;
  errorAccountCount: number;
  failedPostCount: number;
  todaysRemainingScheduled: number;
  monthSuccessRate: number;
  recentErrors: { type: 'post' | 'reply' | 'account'; id: string; at: number; message: string }[];
};

const numberFmt = (n: number | undefined) => (typeof n === 'number' ? n.toLocaleString() : '-');

export default function DashboardPage() {
  // 【追加】状態
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'post' | 'reply' | 'account'>('all');
  const [detail, setDetail] = useState<{ id: string; message: string } | null>(null);

  // 【追加】初回ロード
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/dashboard-stats', { method: 'GET', cache: 'no-store' });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(t || `HTTP ${res.status}`);
        }
        const json: DashboardStats = await res.json();
        setStats(json);
      } catch (e: any) {
        setErrorMsg(e?.message || '読み込みに失敗しました');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 【追加】タブ適用後のエラー一覧
  const filteredErrors = useMemo(() => {
    if (!stats) return [];
    if (activeTab === 'all') return stats.recentErrors;
    return stats.recentErrors.filter(e => e.type === activeTab);
  }, [stats, activeTab]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse text-sm text-gray-500">読み込み中...</div>
      </div>
    );
  }
  if (errorMsg) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-700">
          ダッシュボードの読み込みに失敗しました：{errorMsg}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* 【追加】要約カード */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <SummaryCard title="登録スレッズアカウント" value={numberFmt(stats?.accountCount)} />
        <SummaryCard title="未投稿の予約投稿" value={numberFmt(stats?.scheduledCount)} />
        <SummaryCard title="当日の投稿" value={numberFmt(stats?.todaysPostedCount)} />
        <SummaryCard title="未返信リプ / 返信済" value={`${numberFmt(stats?.unrepliedCount)} / ${numberFmt(stats?.repliedCount)}`} />
        <SummaryCard title="エラーのアカウント" value={numberFmt(stats?.errorAccountCount)} tone="danger" />
        <SummaryCard title="エラーの投稿" value={numberFmt(stats?.failedPostCount)} tone="danger" />
        <SummaryCard title="本日これからの予約" value={numberFmt(stats?.todaysRemainingScheduled)} />
        <SummaryCard title="今月の投稿成功率" value={`${numberFmt(stats?.monthSuccessRate)}%`} />
      </section>

      {/* 【追加】最近のエラー（タブ＋リスト） */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-semibold">最近のエラー（直近7日・最大20件）</h2>
          <Tabs active={activeTab} onChange={setActiveTab} />
        </div>

        {filteredErrors.length === 0 ? (
          <div className="px-4 py-8 text-sm text-gray-500">表示するエラーはありません。</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filteredErrors.map((e) => (
              <li key={`${e.type}-${e.id}-${e.at}`} className="px-4 py-3 hover:bg-gray-50">
                <button
                  className="w-full text-left"
                  onClick={() => setDetail({ id: e.id, message: e.message })}
                >
                  <div className="flex items-center gap-2">
                    <span className={badgeClass(e.type)}>{labelOf(e.type)}</span>
                    <span className="text-xs text-gray-400">
                      {new Date(e.at * 1000).toLocaleString('ja-JP')}
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-sm text-gray-700">{e.message}</div>
                  <div className="mt-1 text-xs text-gray-400">ID: {e.id}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 【追加】詳細モーダル */}
      {detail && (
        <Modal onClose={() => setDetail(null)} title="エラー詳細">
          <div className="space-y-3">
            <div>
              <div className="text-xs text-gray-400">対象ID</div>
              <div className="text-sm">{detail.id}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400">メッセージ</div>
              <pre className="whitespace-pre-wrap break-all text-sm">{detail.message}</pre>
            </div>
            <div className="pt-2">
              <button
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
                onClick={() => navigator.clipboard.writeText(`[${detail.id}] ${detail.message}`)}
              >
                コピー
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// 【追加】要約カード（Tailwindのみ）
function SummaryCard({ title, value, tone = 'default' }: { title: string; value: React.ReactNode; tone?: 'default' | 'danger' }) {
  const toneCls = tone === 'danger' ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white';
  return (
    <div className={`rounded-xl border ${toneCls} p-4`}>
      <div className="text-xs text-gray-500">{title}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

// 【追加】タブ
function Tabs({ active, onChange }: { active: 'all' | 'post' | 'reply' | 'account'; onChange: (t: any) => void }) {
  const tabs: Array<{ key: typeof active; label: string }> = [
    { key: 'all', label: 'すべて' },
    { key: 'post', label: '投稿' },
    { key: 'reply', label: 'リプ' },
    { key: 'account', label: 'アカウント' },
  ];
  return (
    <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1">
      {tabs.map(t => (
        <button
          key={t.key}
          className={`px-3 py-1.5 text-sm rounded-md ${active === t.key ? 'bg-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// 【追加】バッジ
function badgeClass(type: 'post' | 'reply' | 'account') {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs';
  if (type === 'post') return `${base} bg-orange-50 text-orange-700 ring-1 ring-orange-200`;
  if (type === 'reply') return `${base} bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200`;
  return `${base} bg-rose-50 text-rose-700 ring-1 ring-rose-200`;
}
function labelOf(type: 'post' | 'reply' | 'account') {
  if (type === 'post') return '投稿';
  if (type === 'reply') return 'リプ';
  return 'アカウント';
}

// 【追加】モーダル（簡易）
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[95vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button className="rounded-md p-1 hover:bg-gray-100" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
