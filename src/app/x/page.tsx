"use client";
import AppLayout from '@/components/AppLayout';

export default function XPage() {
  return (
    <AppLayout>
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">X 管理</h1>
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white dark:bg-gray-800 p-4 rounded shadow dark:shadow-none dark:border dark:border-gray-700">
            <h2 className="font-semibold mb-3 text-gray-800 dark:text-gray-100">アカウント一覧</h2>
            <a href="/x/accounts" className="text-indigo-600 dark:text-indigo-400 hover:underline">アカウント一覧を開く</a>
          </div>
          {/* 予約投稿一覧（/x/scheduled-posts）は削除済みのためリンクを削除 */}
        </div>
      </div>
    </AppLayout>
  );
}


