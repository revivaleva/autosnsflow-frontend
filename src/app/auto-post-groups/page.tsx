
import AutoPostGroupsEditor from "./AutoPostGroupsEditor";
import AppLayout from "@/components/AppLayout";

export default async function AutoPostGroupsPage() {
  // middlewareで認証チェック済み
  return (
    <AppLayout>
      <AutoPostGroupsEditor/>
    </AppLayout>
  );
}