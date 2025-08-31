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
  postId?: string;
  numericPostId?: string; // 数字の投稿ID（リプライ取得用）
  postUrl?: string; // 投稿URL
  isDeleted?: boolean;
  // 削除日時（予約が削除された/削除予定のタイムスタンプ秒）
  deletedAt?: number;
  // 削除予定時刻（投稿後に設定される可能性がある）
  deleteScheduledAt?: number;
  replyCount?: number;
  // 予約側に保存される二段階投稿希望フラグ
  secondStageWanted?: boolean;
  // リプライ状況
  replyStatus?: {
    replied: number;
    total: number;
  };
  // 二段階投稿関連
  doublePostStatus?: string;
  secondStagePostId?: string;
  secondStageAt?: string | number;
  timeRange?: string;
};

type AccountItem = {
  accountId: string;
  displayName: string;
  autoPostGroupId?: string;
  // [KEEP] サーバ側で使用。フロントでは送信しない
  personaSimple?: string;
  personaDetail?: string;
  personaMode?: "simple" | "detail"; // [ADD]
};

type AutoPostGroup = {
  groupId: string; // [KEEP] 取得時に groupKey→groupId へ正規化
  groupName: string;
};

type AutoPostGroupItem = {
  order: number;
  timeRange: string;
  theme: string;
  enabled?: boolean;
  // スロットで二段階投稿を指定できる
  secondStageWanted?: boolean;
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
function parseAutoPostGroupId(v?: string): { groupName: string; type: number | null } {
  const m = String(v || "").match(/^(.*?)-自動投稿(\d+)$/);
  if (!m) return { groupName: "", type: null };
  return { groupName: m[1], type: Number(m[2]) };
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

// [ADD] detail(JSON文字列) → 日本語の行テキストへ整形
function formatPersonaDetail(detail?: string): string {
  if (!detail) return "";
  try {
    const obj = JSON.parse(detail);
    const labels: Record<string, string> = {
      name: "名前",
      age: "年齢",
      gender: "性別",
      job: "職業",
      lifestyle: "生活スタイル",
      character: "口調・内面",
      vocabulary: "語彙傾向",
      emotionPattern: "感情パターン",
      erotic: "エロ表現",
      target: "ターゲット層",
      purpose: "投稿目的",
      distance: "絡みの距離感",
      ng: "NG要素",
    };
    const order = [
      "name",
      "age",
      "gender",
      "job",
      "lifestyle",
      "character",
      "vocabulary",
      "emotionPattern",
      "erotic",
      "target",
      "purpose",
      "distance",
      "ng",
    ];
    const lines = order
      .map((k) => {
        const v = obj?.[k];
        if (v === undefined || v === null || v === "") return "";
        return `${labels[k] || k}: ${String(v)}`;
      })
      .filter(Boolean);
    return lines.join("\n");
  } catch {
    // JSONでなければそのまま返す
    return detail;
  }
}

export default function ScheduledPostEditorModal({ open, mode, initial, onClose, onSave }: Props) {
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [groups, setGroups] = useState<AutoPostGroup[]>([]);
  const [masterPrompt, setMasterPrompt] = useState<string>(""); // [ADD]
  const [userSettings, setUserSettings] = useState<any>(null);

  const [accountId, setAccountId] = useState(initial?.accountId || "");
  const [accountName, setAccountName] = useState(initial?.accountName || "");
  const [groupId, setGroupId] = useState("");
  const [autoType, setAutoType] = useState<number | null>(null);
  const [groupItems, setGroupItems] = useState<AutoPostGroupItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [theme, setTheme] = useState(initial?.theme || "");
  const [content, setContent] = useState(initial?.content || "");
  const [scheduledAtLocal, setScheduledAtLocal] = useState(
    mode === "edit" ? toLocalDatetimeValueAny(initial?.scheduledAt) : "" // [FIX] Any対応
  );
  // 二段階投稿チェック/削除予定/親削除フラグ
  const [secondStageWantedFlag, setSecondStageWantedFlag] = useState<boolean>(!!initial?.secondStageWanted);
  const [deleteScheduledLocal, setDeleteScheduledLocal] = useState<string>(initial?.deleteScheduledAt ? toLocalDatetimeValue(initial.deleteScheduledAt) : "");
  const [deleteScheduledEnabled, setDeleteScheduledEnabled] = useState<boolean>(!!initial?.deleteScheduledAt);
  const [deleteParentAfterFlag, setDeleteParentAfterFlag] = useState<boolean>(false);
  // 投稿時間範囲（HH:MM）
  const [timeStart, setTimeStart] = useState<string>("00:00");
  const [timeEnd, setTimeEnd] = useState<string>("23:59");

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
        }));
        setGroups(normalized);
      } catch (e) {
        console.log("auto-post-groups load error:", e);
      }
    })();

    // [ADD] 設定（マスタープロンプト）取得
    (async () => {
      try {
        const r = await fetch("/api/settings", {
          credentials: "include",
          cache: "no-store",
        });
        if (r.ok) {
          const j = await r.json();
          const s = j?.settings || j;
          setMasterPrompt(s?.masterPrompt || "");
          setUserSettings(s || null);
        }
      } catch (e) {
        console.log("settings load error:", e);
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

    // モーダル開時にユーザー設定から二段階削除・親削除の既定値を反映（追加モード時）
    if (mode === "add") {
      if (userSettings) {
        if (typeof userSettings.parentDelete !== 'undefined') setDeleteParentAfterFlag(!!userSettings.parentDelete);
        if (typeof userSettings.doublePostDelete !== 'undefined') setDeleteScheduledEnabled(!!userSettings.doublePostDelete);
        const delayMin = Number(userSettings?.doublePostDeleteDelay || 0);
        if (delayMin > 0 && scheduledAtLocal) {
          const base = new Date(scheduledAtLocal);
          base.setMinutes(base.getMinutes() + delayMin);
          setDeleteScheduledLocal(formatDateToLocal(base));
        }
      }
      // スロットの二段階投稿既定を反映
      if (autoType && groupItems && groupItems.length >= autoType) {
        const slot = groupItems[autoType - 1];
        if (typeof slot.secondStageWanted !== 'undefined') setSecondStageWantedFlag(!!slot.secondStageWanted);
      }
    }

    // 初期 timeRange（編集時）
    if (mode === "edit") {
      const tr = initial?.timeRange || "";
      const m = String(tr).match(/^(\d{2}:\d{2})\s*[-～~]\s*(\d{2}:\d{2})$/);
      if (m) {
        setTimeStart(m[1]);
        setTimeEnd(m[2]);
      } else {
        setTimeStart("00:00");
        setTimeEnd("23:59");
      }
    } else {
      setTimeStart("00:00");
      setTimeEnd("23:59");
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

  // [ADD] グループのスロットを読み込み（可変件数）
  useEffect(() => {
    (async () => {
      if (!selectedGroup?.groupId) {
        setGroupItems([]);
        return;
      }
      try {
        const r = await fetch(`/api/auto-post-group-items?groupKey=${encodeURIComponent(selectedGroup.groupId)}`, {
          credentials: "include",
        });
        if (!r.ok) {
          setGroupItems([]);
          return;
        }
        const j = await r.json();
        const items: AutoPostGroupItem[] = (j?.items || []).map((it: any) => ({
          order: Number(it.order ?? 0),
          timeRange: String(it.timeRange || ""),
          theme: String(it.theme || ""),
          enabled: it.enabled !== false,
          secondStageWanted: !!it.secondStageWanted,
        }));
        const enabledSorted = items
          .filter((x) => x.enabled)
          .sort((a, b) => a.order - b.order);
        setGroupItems(enabledSorted);
        if (enabledSorted.length > 0 && (autoType === null || autoType < 1 || autoType > enabledSorted.length)) {
          setAutoType(1);
        }
      } catch {
        setGroupItems([]);
      }
    })();
  }, [selectedGroup?.groupId]);

  // [MOD] 種別変更時：テーマ・時間帯をスロットから反映
  useEffect(() => {
    if (!autoType || groupItems.length === 0) return;
    const idx = autoType - 1;
    const slot = groupItems[idx];
    if (!slot) return;
    if (slot.theme) setTheme(slot.theme);
    const tr = slot.timeRange;
    if (tr && /\d{2}:\d{2}.*\d{2}:\d{2}/.test(tr)) {
      const [s, e] = tr.split(/-|～|~/).map((x) => x.trim());
      setTimeStart((s || "00:00").slice(0, 5));
      setTimeEnd((e || "23:59").slice(0, 5));
    } else {
      setTimeStart("00:00");
      setTimeEnd("23:59");
    }

    // [DEL] 種別選択時に予約時刻を自動設定していた処理を削除
  }, [autoType, groupItems]); // eslint-disable-line

  // [FIX] 追加：open/mode/initial の変化時にフォームへ同期（編集時）
  useEffect(() => {
    if (!open) return;
    // 初回表示や mode/initial が変わったときに前回のフォーム値が残らないように初期化
    if (mode === "add") {
      setAccountId("");
      setAccountName("");
      setTheme("");
      setContent("");
      setScheduledAtLocal("");
      setAutoType(null);
      setGroupId("");
      setTimeStart("00:00");
      setTimeEnd("23:59");
    }

    if (mode === "edit" && initial) {
      setAccountId(initial.accountId || "");
      setAccountName(initial.accountName || "");
      setTheme(initial.theme || "");
      setContent(initial.content || "");
      setScheduledAtLocal(toLocalDatetimeValueAny(initial.scheduledAt)); // [FIX]
      setSecondStageWantedFlag(!!initial.secondStageWanted);
      setDeleteScheduledLocal(initial?.deleteScheduledAt ? toLocalDatetimeValue(initial.deleteScheduledAt) : "");
      setDeleteScheduledEnabled(!!initial?.deleteScheduledAt);
      setDeleteParentAfterFlag(!!(initial as any).deleteParentAfter);
      // [MOD] 種別/グループは initial.autoPostGroupId 側で復元するためここではクリア
      setAutoType(null);
      setGroupId("");
    }
  }, [open, mode, initial]);

  // AI生成時に自動投稿グループやユーザー設定からチェック状態を反映するユーティリティ
  const applyDefaultsFromGroupAndSettings = () => {
    // 自動投稿グループのスロット設定を参照
    if (autoType && groupItems && groupItems.length >= autoType) {
      const slot = groupItems[autoType - 1];
      if (typeof slot.secondStageWanted !== 'undefined') setSecondStageWantedFlag(!!slot.secondStageWanted);
    }
    // ユーザー設定から親削除・二段階削除の既定値を参照
    if (userSettings) {
      if (typeof userSettings.parentDelete !== 'undefined') setDeleteParentAfterFlag(!!userSettings.parentDelete);
      if (typeof userSettings.doublePostDelete !== 'undefined') {
        // if doublePostDelete true, enable deleteScheduled checkbox
        setDeleteScheduledEnabled(!!userSettings.doublePostDelete);
        // if there is a configured delay, prefill deleteScheduledLocal as scheduledAtLocal + delay
        const delayMin = Number(userSettings.doublePostDeleteDelay || 0);
        if (delayMin > 0 && scheduledAtLocal) {
          const base = new Date(scheduledAtLocal);
          base.setMinutes(base.getMinutes() + delayMin);
          setDeleteScheduledLocal(formatDateToLocal(base));
        }
      }
    }
  };

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
      timeRange: `${timeStart}-${timeEnd}`,
      // 二段階投稿/削除予定/親削除フラグ
      secondStageWanted: !!secondStageWantedFlag,
      deleteScheduledAt: deleteScheduledEnabled && deleteScheduledLocal ? datetimeLocalToEpochSec(deleteScheduledLocal) : undefined,
      // note: deleteParentAfterFlag will be sent from editor if true
    };

    // attach deleteParentAfter only if true to avoid adding undefined to some Put flows
    const outPayload = { ...payload } as any;
    if (deleteParentAfterFlag) outPayload.deleteParentAfter = true;

    await onSave(outPayload);
    onClose();
  };

  // ====== ここを変更 ======
  const handleClickGenerate = async () => {
    if (isGenerating) return; // prevent double-click
    if (!theme) {
      alert("テーマを入力/選択してください");
      return;
    }
    if (!accountId) {
      alert("アカウントを選択してください");
      return;
    }

    // [ADD] 予約日時のセットは「AIで生成」押下時に実施
    if (selectedGroup && autoType) {
      const idx = autoType - 1;
      const slot = groupItems[idx];
      const hhmm = randomTimeInRange(slot?.timeRange || "");
      if (hhmm) {
        const base = scheduledAtLocal || toLocalDatetimeValue(Math.floor(Date.now() / 1000));
        const datePart = base.split("T")[0] || "";
        if (datePart) setScheduledAtLocal(`${datePart}T${hhmm}`);
      }
    }

    // [ADD] ペルソナ選択（personaMode により simple/detail を使い分け）
    const a = selectedAccount;
    let personaText = "";
    let personaModeUsed: "simple" | "detail" | "" = "";
    if (a?.personaMode === "detail" && a?.personaDetail) {
      personaText = formatPersonaDetail(a.personaDetail);
      personaModeUsed = "detail";
    } else if (a?.personaMode === "simple" && a?.personaSimple) {
      personaText = a.personaSimple;
      personaModeUsed = "simple";
    } else if (a?.personaDetail) {
      // フォールバック：detailがあるなら整形して使用
      personaText = formatPersonaDetail(a.personaDetail);
      personaModeUsed = "detail";
    } else if (a?.personaSimple) {
      personaText = a.personaSimple;
      personaModeUsed = "simple";
    }

    // テーマがカンマ区切りで複数ある場合はランダムに1つを選択してテーマ欄に残す
    let themeUsed = String(theme || "");
    if (themeUsed.includes(",")) {
      const parts = themeUsed.split(",").map(s => s.trim()).filter(Boolean);
      if (parts.length > 0) {
        themeUsed = parts[Math.floor(Math.random() * parts.length)];
        setTheme(themeUsed);
      }
    }

    // [ADD] マスタープロンプト + ペルソナ + テーマ を結合して送信
    const prompt = [
      masterPrompt?.trim() ? masterPrompt.trim() : "",
      personaText ? `# ペルソナ\n${personaText}` : "",
      `# テーマ\n${themeUsed}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    // AI生成直前にデフォルトのチェック状態を適用
    applyDefaultsFromGroupAndSettings();

    try {
      setIsGenerating(true);
      const res = await fetch("/api/ai-gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          purpose: "post-generate",
          // [MOD] サーバ側でのログ紐付けのため accountId は送る
          //       実際の生成テキストは prompt をメイン入力にする
          input: { accountId, theme, prompt, personaModeUsed }, // [MOD]
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
    finally {
      setIsGenerating(false);
    }
  };
  // ====== 変更ここまで ======

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 w-[640px] max-w-[96vw] rounded-xl p-5 shadow-xl relative">
        <button type="button" className="absolute top-2 right-2 text-gray-400 text-2xl p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800" onClick={onClose} aria-label="閉じる">×</button>
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
              className="mt-1 w-full border rounded-md px-3 py-2 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-700"
              value={selectedGroup?.groupName || "-"}
              readOnly
            />
          </div>
          <div>
            <label className="block text-sm font-medium">種別</label>
            <select
              value={autoType ?? ""}
              onChange={(e) => setAutoType(e.target.value ? Number(e.target.value) : null)}
              className="mt-1 w-full border rounded-md px-3 py-2"
            >
              <option value="">-</option>
              {groupItems.map((it, idx) => (
                <option key={idx} value={idx + 1}>{`自動投稿${idx + 1}`}</option>
              ))}
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
              className={`px-3 py-2 rounded-md text-white ${isGenerating ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
              disabled={isGenerating}
              style={{ display: 'inline-block' }}
            >
              {isGenerating ? '生成中...' : 'AIで生成'}
            </button>
          </div>
        </div>

        {/* 投稿時間範囲 */}
        <div className="mt-4">
          <label className="block text-sm font-medium">投稿時間範囲</label>
          <div className="flex items-center gap-2 mt-1">
            <input
              type="time"
              value={timeStart}
              onChange={(e) => setTimeStart(e.target.value)}
              className="border rounded-md px-3 py-2"
            />
            <span className="text-gray-500">～</span>
            <input
              type="time"
              value={timeEnd}
              onChange={(e) => setTimeEnd(e.target.value)}
              className="border rounded-md px-3 py-2"
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">グループ未選択時は 00:00～23:59 が既定になります</p>
        </div>

        {/* 二段階投稿・削除設定 */}
        <div className="mt-4 grid grid-cols-3 gap-3 items-center">
          <div>
            <label className="block text-sm font-medium">二段階投稿</label>
            <input type="checkbox" className="mt-2" checked={secondStageWantedFlag} onChange={(e) => setSecondStageWantedFlag(e.target.checked)} />
          </div>
          <div>
            <label className="block text-sm font-medium">二段階投稿削除予定</label>
            <div className="flex items-center gap-2 mt-2">
              <input type="checkbox" checked={deleteScheduledEnabled} onChange={(e) => { setDeleteScheduledEnabled(e.target.checked); if (!e.target.checked) setDeleteScheduledLocal(""); }} />
              <span className="text-xs text-gray-500">チェックすると二段階投稿の削除予定を有効化します（遅延は設定に従います）</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium">親投稿も削除</label>
            <input type="checkbox" className="mt-2" checked={deleteParentAfterFlag} onChange={(e) => setDeleteParentAfterFlag(e.target.checked)} />
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium">予約日時</label>
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
          <button type="submit" className="bg-green-600 text-white rounded px-5 py-2 hover:bg-green-700">
            保存
          </button>
        </div>
      </form>
    </div>
  );
}
