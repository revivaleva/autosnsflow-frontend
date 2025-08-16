// /src/app/settings/page.tsx
// [MOD] サーバ側のCookie判定・redirectを削除。認証はmiddlewareに一元化。
// [ADD] 動的化（Cookie依存のUIずれ回避）
import SettingsForm from "./SettingsForm";
import AppLayout from "@/components/AppLayout";

// [ADD] 静的最適化を回避
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  // [DEL] cookies() / redirect("/login") は削除
  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl p-4">
        <h1 className="mb-4 text-2xl font-bold">ユーザー設定</h1>
        <SettingsForm />
      </div>
    </AppLayout>
  );
}
