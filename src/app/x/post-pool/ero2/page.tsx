import React from "react";
import PostPoolPage from "@/app/post-pool/PostPoolPage";
import AppLayout from "@/components/AppLayout";

export default function Page() {
  return (
    <AppLayout>
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">X: エロ2投稿プール</h1>
        <PostPoolPage poolType="ero2" />
      </div>
    </AppLayout>
  );
}


