"use client";  // これを一行目に追加

import ScheduledPostsTable from "../../ui-components/ScheduledPostsTable";
import AppLayout from "@/components/AppLayout";

export default function AccountsPage() {
  return (
    <AppLayout>
      <ScheduledPostsTable />
    </AppLayout>
  );
}