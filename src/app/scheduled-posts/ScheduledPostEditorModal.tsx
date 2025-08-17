// src/app/scheduled-posts/ScheduledPostEditorModal.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

// === 型（ScheduledPostsTable.tsx と整合） ===
type ScheduledPostStatus = "" | "pending" | "posted";
export type ScheduledPostType = {
  scheduledPostId: string;
  accountName: string;
  accountId: string;
  scheduledAt: string | number;
  content: string;
  theme?: string;
  autoPostGroupId?: string;
  status?: ScheduledPostStatus;
  postedAt?: string | number;
  threadsPostId?: string;
  isDeleted?: boolean;
  replyCount?: number;
};

// [MOD] APIで使う型を拡張（autoPostGroupId / persona 付き）
type AccountItem = {
  accountId: string;
  displayName: string;
  // [ADD] 既定グループ・ペルソナ（API拡張と対応）
  autoPostGroupId?: string;
  personaStatic?: string;
  personaDynamic?: string;
};

type AutoPostGroup = {
  groupId: string;
  groupName: string;
  time1?: string;
  time2?: string;
  time3?: string;
  theme1?: string;
  theme2?: string;
  theme3?: string;
};

type Props = {
  open: boolean;
  mode: "add" | "edit";
  initial?: ScheduledPostType | null;
  onClose: () => void;
  onSave: (data: ScheduledPostType) => Promise<void> | void;
};

// === ユーティリティ ===

// [既存] Date→datetime-local
function toLocalDatetimeValue(epochSec?: number | string) {
  const n = Number(epochSec || 0);
  if (!n) return "";
  const d = new Date(n * 1000);
  const pad = (v: number) => String(v).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

// [既存] datetime-local → UNIX秒
function datetimeLocalToEpochSec(v: string) {
  if (!v) return 0;
  const d = new Date(v);
  return Math.floor(d.getTime() / 1000);
}

// [ADD] "HH:MM-HH:MM" などからランダムな時刻（HH:MM）を返す
function randomTimeInRange(range?: string | null): string | null {
  if (!range) return null;
  const [s, e] = String(range).split(/-|～|~/).map((x) => x.trim());
  if (!s || !e) return null;
  const [sh, sm] = s.split(":").map(Number);
  const [eh, em] = e.split(":").map(Number);
  const start = sh * 60 + (sm || 0);
  const end = eh * 60 + (em || 0);
  if (end < start) return null;
  const r = start + Math.floor(Math.random() * (end - start + 1));
  const hh = String(Math.floor(r / 60)).padStart(2, "0");
  const mm = String(r % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function ScheduledPostEditorModal({
  open,
  mode,
  initial,
  onClose,
  onSave,
}: Props) {
  // === ローカル状態 ===
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [groups, setGroups] = useState<AutoPostGroup[]>([]);

  // 入力項目
  const [accountId, setAccountId] = useState(initial?.accountId || "");
  const [accountName, setAccountName] = useState(initial?.accountName || "");
  // [MOD] グループは「アカウントに紐づくもの」を自動セット、UIは読み取り専用表示
  const [groupId, setGroupId] = useState<string>("");
  // [MOD] 種別は 1/2/3/（null=「-」）
  const [autoType, setAutoType] = useState<1 | 2 | 3 | null>(null);

  const [theme, setTheme] = useState(initial?.theme || "");
  const [content, setContent] = useState(initial?.content || "");

  // [MOD] 予約日時は上位に配置 & 種別選択時に自動セット
  const [scheduledAtLocal, setScheduledAtLocal] = useState(
    mode === "edit" ? toLocalDatetimeValue(initial?.scheduledAt) : ""
  );

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.accountId === accountId) || null,
    [accounts, accountId]
  );
  const selectedGroup = useMemo(
    () => groups.find((g) => g.groupId === groupId) || null,
    [groups, groupId]
  );

  // === 初期ロード ===
  useEffect(() => {
    if (!open) return;

    // アカウント一覧（autoPostGroupId / persona付き）
    (async () => {
      try {
        const r = await fetch("/api/accounts", { credentials: "include" });
        const j = await r.json();
        const list: AccountItem[] = j?.accounts || j?.items || [];
        setAccounts(list);

        // 編集時の補完（アカウント名）
        if (mode === "edit" && initial?.accountId && !initial?.accountName) {
          const a = list.find((x) => x.accountId === initial.accountId);
          if (a) setAccountName(a.displayName);
        }
      } catch (e) {
        console.log("accounts load error:", e);
      }
    })();

    // 自動投稿グループ一覧
    (async () => {
      try {
        const r = await fetch("/api/auto-post-groups", {
          credentials: "include",
        });
        const j = await r.json();
        setGroups(j?.groups || j?.items || []);
      } catch (e) {
        console.log("auto-post-groups load error:", e);
      }
    })();

    // 新規時はデフォルトで「今+30分」
    if (mode === "add" && !scheduledAtLocal) {
      const now = new Date();
      now.setMinutes(now.getMinutes() + 30);
      const pad = (n: number) => String(n).padStart(2, "0");
      const s = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
        now.getDate()
      )}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
      setScheduledAtLocal(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // [ADD] アカウント変更 → アカウント既定の自動投稿グループを自動セット（UIは表示のみ）
  useEffect(() => {
    if (!selectedAccount || groups.length === 0) return;
    const gid = selectedAccount.autoPostGroupId || "";
    const exists = groups.find((g) => g.groupId === gid);
    if (exists) setGroupId(gid);
    else setGroupId(""); // グループ無しアカウントの場合
    // アカウント名も自動反映
    setAccountName(selectedAccount.displayName);
  }, [selectedAccount, groups]);

  // [ADD] 種別選択 → テーマの自動入力 + 時刻帯からランダム時刻を予約日時に反映
  useEffect(() => {
    if (!selectedGroup || !autoType) return;
    const t =
      autoType === 1
        ? selectedGroup.theme1
        : autoType === 2
        ? selectedGroup.theme2
        : selectedGroup.theme3;
    if (t) setTheme(t);

    const timeRange =
      autoType === 1
        ? selectedGroup.time1
        : autoType === 2
        ? selectedGroup.time2
        : selectedGroup.time3;
    const hhmm = randomTimeInRange(timeRange || "");
    if (hhmm) {
      // 既存の「日付」を維持し、時刻だけ差し替え
      const base = scheduledAtLocal || toLocalDatetimeValue(Math.floor(Date.now() / 1000));
      const datePart = base.split("T")[0] || "";
      if (datePart) setScheduledAtLocal(`${datePart}T${hhmm}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoType, selectedGroup]);

  // 保存
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // scheduledPostId: 新規はフロントで生成、編集は既存
    const scheduledPostId =
      mode === "add"
        ? Math.random().toString(36).slice(2, 12)
        : (initial?.scheduledPostId as string);

    const unix = scheduledAtLocal
      ? datetimeLocalToEpochSec(scheduledAtLocal)
      : 0;

    // [MOD] autoPostGroupId の決定
    //  - 種別「-」(null) の場合は空文字（自動投稿グループなし）
    //  - それ以外は「{groupName}-自動投稿{n}」
    let autoPostGroupId = "";
    if (selectedGroup && autoType) {
      autoPostGroupId = `${selectedGroup.groupName}-自動投稿${autoType}`;
    }

    const payload: ScheduledPostType = {
      scheduledPostId,
      accountName,
      accountId,
      scheduledAt: unix,
      content,
      theme,
      autoPostGroupId,
    };

    await onSave(payload);
    onClose();
  };

  // [MOD] AI生成（アカウントのペルソナを自動使用、UI入力/選択は廃止）
  const handleClickGenerate = async () => {
    if (!theme) {
      alert("テーマを入力/選択してください");
      return;
    }
    // アカウントのペルソナ（静優先→動）を使う
    const persona =
      (selectedAccount?.personaStatic || "").trim() ||
      (selectedAccount?.personaDynamic || "").trim() ||
      "";
    try {
      const res = await fetch("/api/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ theme, accountName, persona }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error || "AI生成に失敗しました");
      const text = String(data?.text || "");
      if (!text) {
        alert("生成結果が空でした");
        return;
      }
      setContent(text);
    } catch (e: any) {
      alert(e?.message || "AI生成に失敗しました");
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <form
        className="bg-white rounded-xl shadow-xl p-5 w-[520px] max-w-[95vw]"
        onSubmit={handleSubmit}
      >
        <h3 className="text-lg font-bold mb-3">
          {mode === "add" ? "予約投稿の追加" : "予約投稿の編集"}
        </h3>

        {/* アカウント（選択でグループ自動セット） */}
        <div className="mb-3">
          <label className="block text-xs text-gray-600 mb-1">アカウント</label>
          <select
            className="w-full border rounded px-2 py-1"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            required
          >
            <option value="">選択してください</option>
            {accounts.map((a) => (
              <option key={a.accountId} value={a.accountId}>
                {a.displayName}（id:{a.accountId}）
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                アカウント名
              </label>
              <input
                className="w-full border rounded px-2 py-1 bg-gray-100"
                value={accountName}
                readOnly
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                アカウントID
              </label>
              <input
                className="w-full border rounded px-2 py-1 bg-gray-100"
                value={accountId}
                readOnly
              />
            </div>
          </div>
        </div>

        {/* [MOD] 自動投稿グループ（上段へ移動 & 表示のみ）＋ 種別 */}
        <div className="mb-3 grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className="block text-xs text-gray-600 mb-1">
              自動投稿グループ（アカウント既定）
            </label>
            <input
              className="w-full border rounded px-2 py-1 bg-gray-100"
              value={selectedGroup?.groupName || "（なし）"}
              readOnly
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">種別</label>
            <select
              className="w-full border rounded px-2 py-1"
              value={autoType || ""}
              onChange={(e) =>
                setAutoType(
                  e.target.value ? (Number(e.target.value) as 1 | 2 | 3) : null
                )
              }
            >
              {/* [MOD] 「-」を残す（グループなし自動投稿） */}
              <option value="">-</option>
              <option value="1">自動投稿1</option>
              <option value="2">自動投稿2</option>
              <option value="3">自動投稿3</option>
            </select>
          </div>
        </div>

        {/* [MOD] テーマ（種別選択で自動入力、編集可） */}
        <div className="mb-3">
          <label className="block text-xs text-gray-600 mb-1">テーマ</label>
          <input
            className="w-full border rounded px-2 py-1"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="例: おはよう / ランチ / 仕事前 など"
          />
        </div>

        {/* [MOD] 予約日時（上段→ここはグループの次。種別選択で時刻を自動生成し、手動編集可） */}
        <div className="mb-3">
          <label className="block text-xs text-gray-600 mb-1">予約日時</label>
          <input
            type="datetime-local"
            className="w-full border rounded px-2 py-1"
            value={scheduledAtLocal}
            onChange={(e) => setScheduledAtLocal(e.target.value)}
            required
          />
        </div>

        {/* 本文 + AI生成（ペルソナUIなし・アカウントのペルソナで生成） */}
        <div className="mb-3">
          <div className="flex items-center justify-between">
            <label className="block text-xs text-gray-600 mb-1">
              本文テキスト
            </label>
            <button
              type="button"
              className="bg-blue-500 text-white rounded px-3 py-1 hover:bg-blue-600"
              onClick={handleClickGenerate}
              disabled={!selectedAccount}
            >
              AIで生成
            </button>
          </div>
          <textarea
            className="w-full border rounded px-2 py-1"
            rows={5}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        {/* ボタン */}
        <div className="flex justify-end gap-2 mt-1">
          <button
            type="button"
            className="bg-gray-300 text-gray-800 rounded px-4 py-2"
            onClick={onClose}
          >
            キャンセル
          </button>
          <button
            type="submit"
            className="bg-green-600 text-white rounded px-5 py-2 hover:bg-green-700"
          >
            保存
          </button>
        </div>
      </form>
    </div>
  );
}
