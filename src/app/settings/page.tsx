// /src/app/settings/page.tsx
// [MOD] サーバ側のCookie判定・redirectを削除し、middlewareで一元管理
// [ADD] dynamic を追加して静的最適化を回避

import SettingsForm from "./SettingsForm";
import AppLayout from "@/components/AppLayout";

// [ADD] Cookie依存のため強制的に動的レンダリング
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  // [DEL] サーバ側の cookies() / redirect("/login") は削除
  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl p-4">
        {/* [ADD] タイトル（任意・UI変更のみ） */}
        <h1 className="mb-4 text-2xl font-bold">ユーザー設定</h1>
        <SettingsForm />
      </div>
    </AppLayout>
  );
}
