
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import SettingsForm from "./SettingsForm";
import AppLayout from "@/components/AppLayout";

export default function SettingsPage() {
  const cookieStore = cookies();
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