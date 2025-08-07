"use client";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import SNSAccountsTable from "./SNSAccountsTable";
import AppLayout from "@/components/AppLayout";

export default function AccountsPage() {
  const cookieStore = cookies();
  const idToken = cookieStore.get("idToken");
  if (!idToken?.value) {
    redirect("/login");
  }
  return (
    <AppLayout>
      <SNSAccountsTable/>
    </AppLayout>
  );
}