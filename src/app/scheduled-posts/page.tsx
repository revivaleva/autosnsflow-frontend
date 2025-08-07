"use client";  // これを一行目に追加

import ScheduledPostsTable from "./ScheduledPostsTable"
import AppLayout from "@/components/AppLayout";

export default function ScheduledPostsPage() {
  return (
    <AppLayout>
      <ScheduledPostsTable/>
    </AppLayout>
  );
}