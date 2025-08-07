"use client";  // これを一行目に追加

import SettingsForm from "./SettingsForm";
import AppLayout from "@/components/AppLayout";

export default function SettingsPage() {
  return (
    <AppLayout>
      <SettingsForm/>
    </AppLayout>
  );
}