
import RepliesList from "./RepliesList";
import AppLayout from "@/components/AppLayout";

export default async function RepliesPage() {
  // middlewareで認証チェック済み
  return (
    <AppLayout>
       <RepliesList/>
    </AppLayout>
  );
}
