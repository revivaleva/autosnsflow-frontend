"use client";

import React from "react";

type AIPersonaPayload = {
  personaDetail: any;
  personaSimple: string;
};

type AIGeneratedPersonaModalProps = {
  open: boolean;
  onClose: () => void;
  personaDetail: string;
  personaSimple: string;
  onApply: (payload: AIPersonaPayload) => void;
};

export default function AIGeneratedPersonaModal({
  open,
  onClose,
  personaDetail,
  personaSimple,
  onApply,
}: AIGeneratedPersonaModalProps) {
  if (!open) { return null; }
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
      <div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded shadow-lg w-full max-w-xl p-6">
        <h3 className="font-bold text-lg mb-3">AI生成ペルソナ内容を確認</h3>
        <div className="border rounded bg-gray-50 p-3 my-2">
          <div className="text-sm text-gray-700 mb-1">簡易ペルソナ</div>
          <div className="text-xs whitespace-pre-wrap break-all bg-white p-2 rounded mb-2">
            {personaSimple || <span className="text-gray-400">（未生成）</span>}
          </div>
          <div className="text-sm text-gray-700 mb-1">詳細ペルソナ</div>
          <pre className="text-xs whitespace-pre-wrap break-all bg-white p-2 rounded">
            {typeof personaDetail === "string" ? personaDetail : JSON.stringify(personaDetail, null, 2)}
          </pre>
        </div>
        <div className="flex justify-end mt-3 gap-2">
          <button
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
            onClick={() => onApply({ personaDetail, personaSimple })}
            disabled={!personaSimple && !personaDetail}
          >
            この内容でセット
          </button>
        </div>
      </div>
    </div>
  );
}


