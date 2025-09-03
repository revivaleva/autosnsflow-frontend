"use client";
import React from "react";

export default function LoadingOverlay({ open, message = "処理中..." }: { open: boolean; message?: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
      <div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-6 rounded-xl shadow">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-4 border-t-transparent border-blue-500 rounded-full animate-spin" />
          <div className="font-medium">{message}</div>
        </div>
      </div>
    </div>
  );
}


