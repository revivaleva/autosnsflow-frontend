
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import RepliesList from "./RepliesList";
import AppLayout from "@/components/AppLayout";

export default async function RepliesPage() {
  const cookieStore = await cookies();
  const idToken = cookieStore.get("idToken");
  if (!idToken?.value) {
    redirect("/login");
  }
  return (
    <AppLayout>
       <RepliesList/>
    </AppLayout>
  );
}
