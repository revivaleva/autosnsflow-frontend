"use client";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AutoPostGroupsEditor from "./AutoPostGroupsEditor";
import AppLayout from "@/components/AppLayout";

export default function AutoPostGroupsPage() {
  const cookieStore = cookies();
  const idToken = cookieStore.get("idToken");
  if (!idToken?.value) {
    redirect("/login");
  }
  return (
    <AppLayout>
      <AutoPostGroupsEditor/>
    </AppLayout>
  );
}