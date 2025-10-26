"use client";
import AppLayout from '@/components/AppLayout';

export default function XPage() {
  return (
    <AppLayout>
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">X 管理</h1>
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white p-4 rounded shadow">
            <h2 className="font-semibold mb-3">アカウント一覧</h2>
            <a href="/x/accounts" className="text-indigo-600 hover:underline">アカウント一覧を開く</a>
          </div>
          <div className="bg-white p-4 rounded shadow">
            <h2 className="font-semibold mb-3">予約投稿一覧</h2>
            <a href="/x/scheduled-posts" className="text-indigo-600 hover:underline">予約投稿一覧を開く</a>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}


