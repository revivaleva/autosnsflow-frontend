import React from "react";
import XAccountsTable from "../XAccountsTable";
import AppLayout from "@/components/AppLayout";

export default function Page() {
  return (
    <AppLayout>
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">X: エロアカウント一覧</h1>
        <XAccountsTable onlyType="ero" />
      </div>
    </AppLayout>
  );
}


