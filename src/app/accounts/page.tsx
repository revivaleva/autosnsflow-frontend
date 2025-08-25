
import SNSAccountsTable from "./SNSAccountsTable";
import AppLayout from "@/components/AppLayout";

export default async function AccountsPage() {
  // middlewareで認証チェック済み
  return (
    <AppLayout>
      <SNSAccountsTable/>
    </AppLayout>
  );
}