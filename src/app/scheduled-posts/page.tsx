
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ScheduledPostsTable from "./ScheduledPostsTable"
import AppLayout from "@/components/AppLayout";


export default async function ScheduledPostsPage() {
  const cookieStore = await cookies();
  const idToken = cookieStore.get("idToken");
  if (!idToken?.value) {
    redirect("/login");
  }
  return (
    <AppLayout>
      <ScheduledPostsTable/>
    </AppLayout>
  );
}