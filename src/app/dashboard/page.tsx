
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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

// src/app/dashboard/page.tsx
export default async function DashboardPage() {
  const cookieStore = await cookies();
  const idToken = cookieStore.get("idToken");

  // Cookieがなければ/loginへリダイレクト
  if (!idToken?.value) {
    redirect("/login");
  }

  // Cookieがある（＝認証済み）場合のみ以下を表示
  return (
    <div>
      <h1 className="text-xl font-bold mb-4">ダッシュボード</h1>
      {/* 以下コンテンツ */}
    </div>
  );
}
