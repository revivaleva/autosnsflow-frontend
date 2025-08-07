"use client";  // これを一行目に追加

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ScheduledPostsTable from "./ScheduledPostsTable"
import AppLayout from "@/components/AppLayout";

export default function ScheduledPostsPage() {
  const cookieStore = cookies();
  const idToken = cookieStore.get("idToken");
  if (!idToken?.value) {
    redirect("/login");
  }
  return (
    <AppLayout>
      <ScheduledPostsTable/>
    </AppLayout>
  );
}