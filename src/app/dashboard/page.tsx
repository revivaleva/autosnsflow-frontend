"use client";

import AppLayout from "@/components/AppLayout";

// 仮データ
const MOCK = {
  accounts: 3,
  upcoming: 8,
  successRate: 92, // %
  pending: 2,
};

const stats = [
  {
    label: "アカウント数",
    value: MOCK.accounts,
    icon: "👤",
    color: "bg-blue-500",
  },
  {
    label: "近日予約件数",
    value: MOCK.upcoming,
    icon: "🗓️",
    color: "bg-green-500",
  },
  {
    label: "投稿成功率",
    value: `${MOCK.successRate}%`,
    icon: "✅",
    color: "bg-yellow-500",
  },
  {
    label: "未実行数",
    value: MOCK.pending,
    icon: "⏳",
    color: "bg-red-500",
  },
];

export default function DashboardPage() {
  return (
    <AppLayout>
      <div>
        <h1 className="text-2xl font-bold mb-6">ダッシュボード</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
          {stats.map((s) => (
            <div
              key={s.label}
              className={`flex items-center rounded-2xl p-5 shadow ${s.color} text-white`}
            >
              <span className="text-3xl mr-4">{s.icon}</span>
              <div>
                <div className="text-xl font-semibold">{s.value}</div>
                <div className="text-sm opacity-80">{s.label}</div>
              </div>
            </div>
          ))}
        </div>
        {/* 必要に応じてここにグラフやサマリテーブルも追加 */}
      </div>
    </AppLayout>
  );
}
