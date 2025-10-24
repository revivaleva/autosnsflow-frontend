"use client";
import XScheduledPostsTable from '@/app/x/XScheduledPostsTable';
import AppLayout from '@/components/AppLayout';

export default function XScheduledPostsPage() {
  return (
    <AppLayout>
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">X：予約投稿一覧</h1>
        <XScheduledPostsTable />
      </div>
    </AppLayout>
  );
}



