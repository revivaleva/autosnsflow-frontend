// src/app/scheduled-posts/ScheduledPostEditorModal.tsx
"use client";

// [MOD] 要件反映版：グループ自動セット/種別→テーマ&時刻自動/AIボタン位置変更
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

// [MOD] アカウントに autoPostGroupId / persona を持たせる
type AccountItem = {
  accountId: string;
  displayName: string;
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

// ==== utils ====
const pad = (n: number) => String(n).padStart(2, "0");

function toLocalDatetimeValue(epochSec?: number | string) {
  const n = Number(epochSec || 0);
  if (!n) return "";
  const d = new Date(n * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function datetimeLocalToEpochSec(v: string) {
  if (!v) return 0;
  return Math.floor(new Date(v).getTime() / 1000);
}

// [ADD] "HH:MM-HH:MM" / "HH:MM～HH:MM" / "HH:MM~HH:MM" → ランダム時刻(HH:MM)
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

// [ADD] アカウントに紐づくグループを groups から解決（groupId / groupName どちらでもOK）
function resolveGroupForAccount(
  account: AccountItem | null,
  groups: AutoPostGroup[]
): AutoPostGroup | null {
  if (!account) return null;
  const key = (account.autoPostGroupId || "").trim();
  if (!key) return null;
  return (
    groups.find((g) => g.groupId === key) ||
    groups.find((g) => g.groupName === key) ||
    null
  );
}

export default function ScheduledPostEditorModal({
  open,
  mode,
  initial,
  onClose,
  onSave,
}: Props) {
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [groups, setGroups] = useState<AutoPostGroup[]>([]);

  const [accountId, setAccountId] = useState(initial?.accountId || "");
  const [accountName, setAccountName] = useState(initial?.accountName || "");

  // [MOD] グループは自動セット用に内部 id を保持（表示は groupName のみ）
  const [groupId, setGroupId] = useState<string>("");

  // [MOD] 種別は 1/2/3 or null(=「-」)
  const [autoType, setAutoType] = useState<1 | 2 | 3 | null>(null);

  const [theme, setTheme] = useState(initial?.theme || "");
  const [content, setContent] = useState(initial?.content || "");

  // [MOD] 予約日時はグループより下に置くが、種別選択時に自動セット
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

  // ==== 初期ロード ====
  useEffect(() => {
    if (!open) return;

    // [MOD] アカウントは /threads-accounts を優先、空なら /accounts をフォールバック
    (async () => {
      try {
        let list: AccountItem[] = [];
        const r1 = await fetch("/api/threads-accounts", { credentials: "include" });
        if (r1.ok) {
          const j = await r1.json();
          list = j?.accounts || j?.items || [];
        }
        if (!Array.isArray(list) || list.length === 0) {
          const r2 = await fetch("/api/accounts", { credentials: "include" });
          if (r2.ok) {
            const j2 = await r2.json();
            list = j2?.accounts || j2?.items || [];
          }
        }
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

    (async () => {
      try {
        const r = await fetch("/api/auto-post-groups", { credentials: "include" });
        const j = await r.json();
        setGroups(j?.groups || j?.items || []);
      } catch (e) {
        console.log("auto-post-groups load error:", e);
      }
    })();

    // 新規時デフォルト日時（今+30分）
    if (mode === "add" && !scheduledAtLocal) {
      const now = new Date();
      now.setMinutes(now.getMinutes() + 30);
      setScheduledAtLocal(
        `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(
          now.getHours()
        )}:${pad(now.getMinutes())}`
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // [MOD] アカウント or groups が変わったら、アカウント既定の自動投稿グループを自動セット
  useEffect(() => {
    const g = resolveGroupForAccount(selectedAccount, groups);
    setGroupId(g?.groupId || "");
    setAccountName(selectedAccount?.displayName || "");
  }, [selectedAccount, groups]);

  // [MOD] 種別選択 → テーマ自動入力 + 時刻帯からランダム時刻を予約に反映（「-」は何もしない）
  useEffect(() => {
    if (!selectedGroup || !autoType) return;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoType, selectedGroup]);

  // ==== 保存 ====
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const scheduledPostId =
      mode === "add" ? Math.random().toString(36).slice(2, 12) : (initial?.scheduledPostId as string);

    const unix = scheduledAtLocal ? datetimeLocalToEpochSec(scheduledAtLocal) : 0;

    // [MOD] 種別が「-」（null）のときは自動投稿グループなし
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

  // [MOD] AI生成：アカウントのペルソナを自動使用、purpose=post-generate
  const handleClickGenerate = async () => {
    if (!theme) {
      alert("テーマを入力/選択してください");
      return;
    }
    const persona =
      (selectedAccount?.personaStatic || "").trim() ||
      (selectedAccount?.personaDynamic || "").trim() ||
      "";
    try {
      const res = await fetch("/api/ai-gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ purpose: "post-generate", input: { theme, persona } }),
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
      <form className="bg-white rounded-xl shadow-xl p-5 w-[520px] max-w-[95vw]" onSubmit={handleSubmit}>
        <h3 className="text-lg font-bold mb-3">{mode === "add" ? "予約投稿の追加" : "予約投稿の編集"}</h3>

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
              <label className="block text-xs text-gray-600 mb-1">アカウント名</label>
              <input className="w-full border rounded px-2 py-1 bg-gray-100" value={accountName} readOnly />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">アカウントID</label>
              <input className="w-full border rounded px-2 py-1 bg-gray-100" value={accountId} readOnly />
            </div>
          </div>
        </div>

        {/* [MOD] 自動投稿グループ（予約日時より上に配置 / 表示のみ）＋ 種別 */}
        <div className="mb-3 grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className="block text-xs text-gray-600 mb-1">自動投稿グループ（アカウント既定）</label>
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
              onChange={(e) => setAutoType(e.target.value ? (Number(e.target.value) as 1 | 2 | 3) : null)}
            >
              {/* 「-」はグループ無しの自動投稿 */}
              <option value="">-</option>
              <option value="1">自動投稿1</option>
              <option value="2">自動投稿2</option>
              <option value="3">自動投稿3</option>
            </select>
          </div>
        </div>

        {/* [MOD] テーマ（右側に AI 生成ボタン → 予約日時より上） */}
        <div className="mb-3">
          <div className="flex items-center justify-between">
            <label className="block text-xs text-gray-600 mb-1">テーマ</label>
            <button
              type="button"
              className="bg-blue-500 text-white rounded px-3 py-1 hover:bg-blue-600"
              onClick={handleClickGenerate}
              disabled={!selectedAccount}
            >
              AIで生成
            </button>
          </div>
          <input
            className="w-full border rounded px-2 py-1"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="例: おはよう / ランチ / 仕事前 など"
          />
        </div>

        {/* [MOD] 予約日時（グループより下。種別選択で自動セット、手動編集可） */}
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

        {/* 本文 */}
        <div className="mb-3">
          <label className="block text-xs text-gray-600 mb-1">本文テキスト</label>
          <textarea
            className="w-full border rounded px-2 py-1"
            rows={5}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2 mt-1">
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
