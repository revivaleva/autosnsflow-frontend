// /src/app/scheduled-posts/ScheduledPostEditorModal.tsx
"use client";

// [MOD] AI生成の送信ペイロードから persona を削除し、accountId のみ送信
import React, { useEffect, useMemo, useState } from "react";

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

type AccountItem = {
  accountId: string;
  displayName: string;
  autoPostGroupId?: string;
  // [KEEP] サーバ側で使用。フロントでは送信しない
  personaSimple?: string;
  personaDetail?: string;
};

type AutoPostGroup = {
  groupId: string; // [KEEP] 取得時に groupKey→groupId へ正規化
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

const pad = (n: number) => String(n).padStart(2, "0");

// 既存：epoch秒 → datetime-local
function toLocalDatetimeValue(epochSec?: number | string) {
  const n = Number(epochSec || 0);
  if (!n) return "";
  const d = new Date(n * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// [ADD] 任意Date → datetime-local へ整形
function formatDateToLocal(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// [ADD] 文字列/数値どちらでも扱える安全版
function toLocalDatetimeValueAny(v?: string | number) {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v === "number") return toLocalDatetimeValue(v);
  const s = String(v).trim();
  if (!s) return "";
  if (/^\d+$/.test(s)) return toLocalDatetimeValue(Number(s));
  let d = new Date(s);
  if (isNaN(d.getTime())) {
    const s2 = s.replace(/\//g, "-").replace(" ", "T");
    d = new Date(s2);
  }
  return isNaN(d.getTime()) ? "" : formatDateToLocal(d);
}

function datetimeLocalToEpochSec(v: string) {
  if (!v) return 0;
  return Math.floor(new Date(v).getTime() / 1000);
}

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
  return `${pad(Math.floor(r / 60))}:${pad(r % 60)}`;
}

// [ADD] 予約投稿の autoPostGroupId ("グループ名-自動投稿2") を分解
function parseAutoPostGroupId(v?: string): { groupName: string; type: 1 | 2 | 3 | null } {
  const m = String(v || "").match(/^(.*?)-自動投稿([123])$/);
  if (!m) return { groupName: "", type: null };
  return { groupName: m[1], type: Number(m[2]) as 1 | 2 | 3 };
}

function resolveGroupForAccount(account: AccountItem | null, groups: AutoPostGroup[]): AutoPostGroup | null {
  if (!account) return null;
  const key = (account.autoPostGroupId || "").trim();
  if (!key) return null;
  return (
    groups.find((g) => g.groupId === key) ||
    groups.find((g) => g.groupName === key) ||
    null
  );
}

export default function ScheduledPostEditorModal({ open, mode, initial, onClose, onSave }: Props) {
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [groups, setGroups] = useState<AutoPostGroup[]>([]);

  const [accountId, setAccountId] = useState(initial?.accountId || "");
  const [accountName, setAccountName] = useState(initial?.accountName || "");
  const [groupId, setGroupId] = useState("");
  const [autoType, setAutoType] = useState<1 | 2 | 3 | null>(null);
  const [theme, setTheme] = useState(initial?.theme || "");
  const [content, setContent] = useState(initial?.content || "");
  const [scheduledAtLocal, setScheduledAtLocal] = useState(
    mode === "edit" ? toLocalDatetimeValueAny(initial?.scheduledAt) : "" // [FIX] Any対応
  );

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.accountId === accountId) || null,
    [accounts, accountId]
  );
  const selectedGroup = useMemo(
    () => groups.find((g) => g.groupId === groupId) || null,
    [groups, groupId]
  );

  useEffect(() => {
    if (!open) return;

    (async () => {
      try {
        let list: AccountItem[] = [];
        const r1 = await fetch("/api/threads-accounts", { credentials: "include" });
        if (r1.ok) {
          const j = await r1.json();
          list = (j?.accounts || j?.items || []) as AccountItem[];
        }
        if (!Array.isArray(list) || list.length === 0) {
          const r2 = await fetch("/api/accounts", { credentials: "include" });
          if (r2.ok) {
            const j2 = await r2.json();
            list = (j2?.accounts || j2?.items || []) as AccountItem[];
          }
        }
        setAccounts(list);

        if (mode === "edit" && initial?.accountId && !initial?.accountName) {
          const a = list.find((x) => x.accountId === initial.accountId);
          if (a) setAccountName(a.displayName);
        }
      } catch (e) {
        console.log("accounts load error:", e);
      }
    })();

    (async () => {
      try {
        const r = await fetch("/api/auto-post-groups", { credentials: "include" });
        const j = await r.json();
        const normalized: AutoPostGroup[] = (j?.groups || j?.items || []).map((g: any) => ({
          groupId: g.groupKey ?? g.groupId ?? "",
          groupName: g.groupName ?? "",
          time1: g.time1 ?? "",
          time2: g.time2 ?? "",
          time3: g.time3 ?? "",
          theme1: g.theme1 ?? "",
          theme2: g.theme2 ?? "",
          theme3: g.theme3 ?? "",
        }));
        setGroups(normalized);
      } catch (e) {
        console.log("auto-post-groups load error:", e);
      }
    })();

    if (mode === "add" && !scheduledAtLocal) {
      const now = new Date();
      now.setMinutes(now.getMinutes() + 30);
      setScheduledAtLocal(
        `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(
          now.getMinutes()
        )}`
      );
    }
  }, [open]); // eslint-disable-line

  // [MOD] 編集モードでは initial.autoPostGroupId を優先して初期選択
  useEffect(() => {
    if (!selectedAccount && !groups.length) return;

    if (mode === "edit" && initial?.autoPostGroupId) {
      const { groupName, type } = parseAutoPostGroupId(initial.autoPostGroupId); // [ADD]
      const g =
        groups.find((x) => x.groupName === groupName) ||
        groups.find((x) => x.groupId === groupName) ||
        null;
      if (g) setGroupId(g.groupId); // [ADD]
      setAutoType(type); // [ADD]
      setAccountName(selectedAccount?.displayName || initial?.accountName || "");
      return; // [ADD] ここで確定（アカウント既定に上書きしない）
    }

    const g = resolveGroupForAccount(selectedAccount, groups);
    setGroupId(g?.groupId || "");
    setAccountName(selectedAccount?.displayName || "");
  }, [selectedAccount, groups, mode, initial?.autoPostGroupId]); // [MOD] 依存に mode/initial を追加

  // [MOD] テーマ/時間の自動反映は「追加時のみ」。編集時は既存値を保持
  useEffect(() => {
    if (!selectedGroup || !autoType) return;
    if (mode === "edit") return; // [ADD] 既存の日時/テーマを上書きしない

    const ty = autoType;
    const autoTheme = ty === 1 ? selectedGroup.theme1 : ty === 2 ? selectedGroup.theme2 : selectedGroup.theme3;
    if (autoTheme) setTheme(autoTheme);

    const timeRange = ty === 1 ? selectedGroup.time1 : ty === 2 ? selectedGroup.time2 : selectedGroup.time3;
    const hhmm = randomTimeInRange(timeRange || "");
    if (hhmm) {
      const base = scheduledAtLocal || toLocalDatetimeValue(Math.floor(Date.now() / 1000));
      const datePart = base.split("T")[0] || "";
      if (datePart) setScheduledAtLocal(`${datePart}T${hhmm}`);
    }
  }, [autoType, selectedGroup, mode]); // eslint-disable-line

  // [FIX] 追加：open/mode/initial の変化時にフォームへ同期（編集時）
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initial) {
      setAccountId(initial.accountId || "");
      setAccountName(initial.accountName || "");
      setTheme(initial.theme || "");
      setContent(initial.content || "");
      setScheduledAtLocal(toLocalDatetimeValueAny(initial.scheduledAt)); // [FIX]
      // [MOD] 種別/グループは initial.autoPostGroupId 側で復元するためここではクリア
      setAutoType(null);
      setGroupId("");
    }
  }, [open, mode, initial]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const scheduledPostId =
      mode === "add" ? Math.random().toString(36).slice(2, 12) : (initial?.scheduledPostId as string);
    const unix = scheduledAtLocal ? datetimeLocalToEpochSec(scheduledAtLocal) : 0;

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

  // ====== ここを変更 ======
  const handleClickGenerate = async () => {
    if (!theme) {
      alert("テーマを入力/選択してください");
      return;
    }
    if (!accountId) {
      alert("アカウントを選択してください");
      return;
    }

    try {
      const res = await fetch("/api/ai-gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          purpose: "post-generate",
          input: { theme, accountId }, // [MOD] persona を送らない
        }),
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
  // ====== 変更ここまで ======

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <form onSubmit={handleSubmit} className="bg-white w-[640px] max-w-[96vw] rounded-xl p-5 shadow-xl">
        <h3 className="text-lg font-semibold mb-4">{mode === "add" ? "予約投稿の追加" : "予約投稿の編集"}</h3>

        <label className="block text-sm font-medium">アカウント</label>
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          required
          className="mt-1 w-full border rounded-md px-3 py-2"
        >
          <option value="">選択してください</option>
          {accounts.map((a) => (
            <option key={a.accountId} value={a.accountId}>
              {a.displayName}（id:{a.accountId}）
            </option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label className="block text-sm text-gray-600">アカウント名</label>
            <input
              className="mt-1 w-full border rounded-md px-3 py-2"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600">アカウントID</label>
            <input className="mt-1 w-full border rounded-md px-3 py-2" value={accountId} readOnly />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <div>
            <label className="block text-sm font-medium">自動投稿グループ（アカウント既定）</label>
            <input
              className="mt-1 w-full border rounded-md px-3 py-2 bg-gray-50"
              value={selectedGroup?.groupName || "-"}
              readOnly
            />
          </div>
          <div>
            <label className="block text-sm font-medium">種別</label>
            <select
              value={autoType ?? ""} // [MOD] 制御化で選択状態を反映
              onChange={(e) => setAutoType(e.target.value ? (Number(e.target.value) as 1 | 2 | 3) : null)}
              className="mt-1 w-full border rounded-md px-3 py-2"
            >
              <option value="">-</option>
              <option value="1">自動投稿1</option>
              <option value="2">自動投稿2</option>
              <option value="3">自動投稿3</option>
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium">テーマ</label>
          <div className="flex gap-2">
            <input
              className="flex-1 border rounded-md px-3 py-2"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="例: おはよう / ランチ / 仕事前 など"
            />
            <button
              type="button"
              onClick={handleClickGenerate}
              className="px-3 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700"
            >
              AIで生成
            </button>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm font厚-medium">予約日時</label>
          <input
            type="datetime-local"
            className="mt-1 w-full border rounded-md px-3 py-2"
            value={scheduledAtLocal}
            onChange={(e) => setScheduledAtLocal(e.target.value)}
            required
          />
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium">本文テキスト</label>
          <textarea
            className="mt-1 w-full min-h-[160px] border rounded-md px-3 py-2"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" className="bg-gray-300 text-gray-800 rounded px-4 py-2" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="bg-green-600 text-white rounded px-5 py-2 hover:bg-green-700">
            保存
          </button>
        </div>
      </form>
    </div>
  );
}
