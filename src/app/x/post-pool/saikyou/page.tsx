import PostPoolPage from "@/app/post-pool/PostPoolPage";
import AppLayout from "@/components/AppLayout";

export default function SaikyouPostPoolPage() {
  return (
    <AppLayout>
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">X: 最強投稿プール</h1>
        <PostPoolPage poolType="saikyou" />
      </div>
    </AppLayout>
  );
}


