import XAccountsTable from "@/app/x/XAccountsTable";
import AppLayout from "@/components/AppLayout";

export default function SaikyouAccountsPage() {
  return (
    <AppLayout>
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">X: 最強アカウント一覧</h1>
        <XAccountsTable onlyType="saikyou" />
      </div>
    </AppLayout>
  );
}


