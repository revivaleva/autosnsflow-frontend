// /src/components/AdminGuard.tsx
// [ADD] 管理ページ用のクライアントガード：再検証してNGならリダイレクト
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { refreshAdminFlag, getAdminFlag } from "@/lib/adminFlag";

export default function AdminGuard({
  children,
  redirectTo = "/dashboard",
}: {
  children: React.ReactNode;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;

    // 1) まずローカルフラグで仮判定（ちらつき防止）
    const first = getAdminFlag();
    if (first) setOk(true);

    // 2) サーバ再検証（正義）— 失敗ならダッシュボードへ
    (async () => {
      const latest = await refreshAdminFlag();
      if (!alive) return;
      if (!latest) {
        setOk(false);
        router.replace(redirectTo);
      } else {
        setOk(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, [redirectTo, router]);

  // NG or リダイレクト中
  if (ok === false) return null;

  // 初期 or 再検証中（簡単なローディング）
  if (ok === null) {
    return <div className="p-8 text-gray-600">検証中...</div>;
  }

  return <>{children}</>;
}
