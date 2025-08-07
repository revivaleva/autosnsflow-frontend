
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import SettingsForm from "./SettingsForm";
import AppLayout from "@/components/AppLayout";

export default async function SettingsPage() {
  const cookieStore = await cookies();
  const idToken = cookieStore.get("idToken");
  if (!idToken?.value) {
    redirect("/login");
  }
  return (
    <AppLayout>
      <SettingsForm/>
    </AppLayout>
  );
}