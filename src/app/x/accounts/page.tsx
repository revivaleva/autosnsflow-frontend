"use client";
import XAccountsTable from '@/app/x/XAccountsTable';
import AppLayout from '@/components/AppLayout';

export default function XAccountsPage() {
  return (
    <AppLayout>
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">X：アカウント一覧</h1>
        <XAccountsTable />
      </div>
    </AppLayout>
  );
}



