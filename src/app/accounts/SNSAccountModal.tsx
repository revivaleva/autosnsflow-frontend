"use client";

import React, { useState, useEffect } from "react";
import AIGeneratedPersonaModal from "./AIGeneratedPersonaModal";
import AccountCopyModal from "./AccountCopyModal";

// 型定義（省略せずそのまま記載）
type AIGeneratedPersonaModalProps = {
  open: boolean;
  onClose: () => void;
  personaDetail: string;
  personaSimple: string;
  onApply: (payload: AIPersonaPayload) => void;
};
type AccountCopyModalProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (account: any) => void;
};
type SNSAccountModalProps = {
  open: boolean;
  onClose: () => void;
  mode?: "create" | "edit";
  account?: any;
  reloadAccounts: () => void;
};
type AIPersonaPayload = {
  personaDetail: any;
  personaSimple: string;
};
type AccountType = {
  accountId: string;
  displayName: string;
  accessToken?: string;
  characterImage?: string;
  personaMode?: "simple" | "detail";
  personaSimple?: string;
  personaDetail?: string;
  autoPostGroupId?: string;
  createdAt?: number;
  /** ▼追加: 2段階投稿用のThreads投稿本文 */
  secondStageContent?: string; // ← 追加（既存コメントは変更しない）
};
type AutoPostGroupType = {
  groupKey: string;
  groupName: string;
};
type PersonaType = {
  name: string;
  age: string;
  gender: string;
  job: string;
  lifestyle: string;
  character: string;
  tone: string;
  vocab: string;
  emotion: string;
  erotic: string;
  target: string;
  purpose: string;
  distance: string;
  ng: string;
};

// AIGeneratedPersonaModal is extracted to its own file to avoid large TSX parsing issues

// AccountCopyModal implementation moved to `src/app/accounts/AccountCopyModal.tsx`

export default function SNSAccountModal({ open, onClose, mode = "create", account, reloadAccounts, }: SNSAccountModalProps) {
  // Minimal placeholder while bisecting parser issue
  if (!open) return null;
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-6 rounded shadow">SNSAccountModal (minimal)</div>
    </div>
  );
}
