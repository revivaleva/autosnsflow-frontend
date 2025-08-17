// src/app/scheduled-posts/ScheduledPostEditorModal.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

// === 型（ScheduledPostsTable.tsx と整合） ===
type ScheduledPostStatus = "" | "pending" | "posted";
export type ScheduledPostType = {
  scheduledPostId: string;
  accountName: string;
  accountId: string;
  scheduledAt: string | number; // 受入時は number(UNIX秒) or 文字列を許容
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
  // ある場合は自動反映に使う
  personaStatic?: string; // 静
  personaDynamic?: string; // 動
  personaSimple?: string;
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
  // add のとき initial は未指定可、edit のとき必須
  initial?: ScheduledPostType | null;
  onClose: () => void;
  onSave: (data: ScheduledPostType) => Promise<void> | void;
};

// === ユーティリティ ===

// [ADD] Date→datetime-local 値（yyyy-MM-ddTHH:mm）へ（ローカルタイム基準）
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

// [ADD] datetime-local → UNIX秒（ローカルタイムをそのまま）
function datetimeLocalToEpochSec(v: string) {
  if (!v) return 0;
  // v は "YYYY-MM-DDTHH:mm"
  const d = new Date(v);
  return Math.floor(d.getTime() / 1000);
}

// [ADD] group と type(1/2/3) からテーマとラベルを生成
function buildAutoPostLabel(g: AutoPostGroup | null, t: 1 | 2 | 3 | null) {
  if (!g || !t) return { label: "", theme: "" };
  const label = `${g.groupName}-自動投稿${t}`;
  const theme =
    t === 1 ? (g.theme1 || "") : t === 2 ? (g.theme2 || "") : (g.theme3 || "");
  return { label, theme };
}

// [ADD] AI生成を叩く（/api/ai-gateway purpose=post-generate）
async function generateByAI({
  persona,
  theme,
}: {
  persona: string;
  theme: string;
}): Promise<string> {
  const res = await fetch("/api/ai-gateway", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      purpose: "post-generate",
      input: { persona, theme },
    }),
  });
  const data = await res.json();
  if (!res.ok || data?.error) {
    throw new Error(data?.error || "AI生成に失敗しました");
  }
  return String(data?.text || "");
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
  const [scheduledAtLocal, setScheduledAtLocal] = useState(
    mode === "edit" ? toLocalDatetimeValue(initial?.scheduledAt) : ""
  );
  const [content, setContent] = useState(initial?.content || "");
  const [theme, setTheme] = useState(initial?.theme || "");
  const [autoPostGroupId, setAutoPostGroupId] = useState(
    initial?.autoPostGroupId || ""
  );

  // ペルソナ（静/動）
  const [personaMode, setPersonaMode] = useState<"static" | "dynamic">("static");
  const [personaStatic, setPersonaStatic] = useState("");
  const [personaDynamic, setPersonaDynamic] = useState("");

  // 自動投稿グループの「どの枠か」(1/2/3)
  const [autoType, setAutoType] = useState<1 | 2 | 3 | null>(null);

  // 選択アカウント
  const selectedAccount = useMemo(
    () => accounts.find((a) => a.accountId === accountId) || null,
    [accounts, accountId]
  );

  // === 初期ロード：アカウント & 自動投稿グループ ===
  useEffect(() => {
    if (!open) return;

    // アカウント
    (async () => {
      try {
        const r = await fetch("/api/threads-accounts", {
          credentials: "include",
        });
        const j = await r.json();
        // 期待: { accounts: [{ accountId, displayName, ... }]}
        const list: AccountItem[] = j?.accounts || j?.items || [];
        setAccounts(list);

        // 編集時、アカウント名が無い場合に補完
        if (mode === "edit" && initial?.accountId && !initial?.accountName) {
          const a = list.find((x) => x.accountId === initial.accountId);
          if (a) setAccountName(a.displayName);
        }

        // ペルソナ初期化（あれば引き継ぎ）
        const a = list.find((x) => x.accountId === (initial?.accountId || ""));
        setPersonaStatic(a?.personaStatic || "");
        setPersonaDynamic(a?.personaDynamic || "");
      } catch (e) {
        console.log("threads-accounts load error:", e);
      }
    })();

    // 自動投稿グループ
    (async () => {
      try {
        const r = await fetch("/api/auto-post-groups", {
          credentials: "include",
        });
        const j = await r.json();
        // 期待: { groups: [{ groupId, groupName, time1, theme1, ... }]}
        setGroups(j?.groups || j?.items || []);

        // 編集時の type 推定（自動投稿ラベルの末尾 1/2/3 を読み取る）
        if (mode === "edit" && initial?.autoPostGroupId) {
          const m = String(initial.autoPostGroupId).match(/自動投稿([123])$/);
          if (m) setAutoType(Number(m[1]) as 1 | 2 | 3);
        }
      } catch (e) {
        console.log("auto-post-groups load error:", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // アカウント選択 → アカウント名/ID自動セット & ペルソナ補完
  useEffect(() => {
    if (!selectedAccount) return;
    setAccountName(selectedAccount.displayName);
    // ペルソナ（静/動）が空なら補完
    if (!personaStatic && selectedAccount.personaStatic) {
      setPersonaStatic(selectedAccount.personaStatic);
    }
    if (!personaDynamic && selectedAccount.personaDynamic) {
      setPersonaDynamic(selectedAccount.personaDynamic);
    }
  }, [selectedAccount]); // eslint-disable-line

  // グループ + 種別 → ラベル & テーマ自動セット
  useEffect(() => {
    const g =
      groups.find((x) =>
        autoPostGroupId ? autoPostGroupId.startsWith(x.groupName) : false
      ) || null;
    const { label, theme: t } = buildAutoPostLabel(g, autoType);
    if (label) setAutoPostGroupId(label);
    if (t && !theme) setTheme(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoType]);

  // 保存
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 新規IDはフロントで生成（既存仕様踏襲）
    const scheduledPostId =
      mode === "add"
        ? Math.random().toString(36).slice(2, 12)
        : (initial?.scheduledPostId as string);

    const unix = scheduledAtLocal
      ? datetimeLocalToEpochSec(scheduledAtLocal)
      : 0;

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

  const handleClickGenerate = async () => {
    const persona =
      personaMode === "static" ? personaStatic || "" : personaDynamic || "";
    if (!theme) {
      alert("テーマを入力/選択してください");
      return;
    }
    try {
      const text = await generateByAI({ persona, theme });
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

        {/* アカウント選択 */}
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <label className="block text-xs text-gray-600 mb-1">
              アカウント
            </label>
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
          </div>

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

        {/* 日時 */}
        <div className="mt-3">
          <label className="block text-xs text-gray-600 mb-1">予約日時</label>
          <input
            type="datetime-local"
            className="w-full border rounded px-2 py-1"
            value={scheduledAtLocal}
            onChange={(e) => setScheduledAtLocal(e.target.value)}
            required
          />
        </div>

        {/* 自動投稿グループ + 種別 */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className="block text-xs text-gray-600 mb-1">
              自動投稿グループ
            </label>
            <select
              className="w-full border rounded px-2 py-1"
              value={
                autoPostGroupId
                  ? groups.find((g) => autoPostGroupId.startsWith(g.groupName))
                      ?.groupId || ""
                  : ""
              }
              onChange={(e) => {
                const g = groups.find((x) => x.groupId === e.target.value);
                if (!g) {
                  setAutoPostGroupId("");
                  return;
                }
                // 既定は type 未選択
                setAutoPostGroupId(`${g.groupName}`);
              }}
            >
              <option value="">（任意）選択してください</option>
              {groups.map((g) => (
                <option key={g.groupId} value={g.groupId}>
                  {g.groupName}
                </option>
              ))}
            </select>
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
              <option value="">-</option>
              <option value="1">自動投稿1</option>
              <option value="2">自動投稿2</option>
              <option value="3">自動投稿3</option>
            </select>
          </div>
        </div>

        {/* テーマ */}
        <div className="mt-3">
          <label className="block text-xs text-gray-600 mb-1">テーマ</label>
          <input
            className="w-full border rounded px-2 py-1"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="例: おはよう / ランチ / 仕事前 など"
          />
        </div>

        {/* 本文 + AI生成 */}
        <div className="mt-3">
          <div className="flex items-center justify-between">
            <label className="block text-xs text-gray-600 mb-1">
              本文テキスト
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs">ペルソナ</span>
              <select
                className="border rounded px-2 py-1 text-xs"
                value={personaMode}
                onChange={(e) =>
                  setPersonaMode(e.target.value as "static" | "dynamic")
                }
              >
                <option value="static">静</option>
                <option value="dynamic">動</option>
              </select>
              <button
                type="button"
                className="bg-blue-500 text-white rounded px-3 py-1 hover:bg-blue-600"
                onClick={handleClickGenerate}
              >
                AIで生成
              </button>
            </div>
          </div>

          <textarea
            className="w-full border rounded px-2 py-1"
            rows={5}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        {/* ペルソナ入力欄（任意） */}
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div>
            <label className="block text-xs text-gray-600 mb-1">
              ペルソナ（静）任意
            </label>
            <textarea
              className="w-full border rounded px-2 py-1 text-xs"
              rows={3}
              value={personaStatic}
              onChange={(e) => setPersonaStatic(e.target.value)}
              placeholder="アカウントの『静』キャラ（丁寧/落ち着きなど）"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">
              ペルソナ（動）任意
            </label>
            <textarea
              className="w-full border rounded px-2 py-1 text-xs"
              rows={3}
              value={personaDynamic}
              onChange={(e) => setPersonaDynamic(e.target.value)}
              placeholder="アカウントの『動』キャラ（元気/勢いなど）"
            />
          </div>
        </div>

        {/* ボタン */}
        <div className="flex justify-end gap-2 mt-4">
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
