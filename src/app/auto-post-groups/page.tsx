"use client";

import { useEffect, useState } from "react";
import AutoPostGroupsEditor from "./AutoPostGroupsEditor";
import AppLayout from "@/components/AppLayout";

export default function AutoPostGroupsPage() {
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    // クライアントでのみlocalStorageを参照
    setUserId(localStorage.getItem("userId"));
  }, []);

  if (!userId) {
    // ログイン前ならAppLayoutのまま空表示でもOK
    return (
      <AppLayout>
        <div>ユーザーID取得中...</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <AutoPostGroupsEditor userId={userId} />
    </AppLayout>
  );
}