
import ScheduledPostsTable from "./ScheduledPostsTable"
import AppLayout from "@/components/AppLayout";

export default async function ScheduledPostsPage() {
  // middlewareで認証チェック済み
  return (
    <AppLayout>
      <ScheduledPostsTable/>
    </AppLayout>
  );
}