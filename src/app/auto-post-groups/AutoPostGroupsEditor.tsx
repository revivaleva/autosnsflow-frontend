// /src/app/auto-post-groups/AutoPostGroupsEditor.tsx

"use client";

import React, { useState, useEffect } from "react";

// =======================
// 型定義
// =======================
export type AutoPostGroupType = {
  groupKey: string;
  groupName: string;
  createdAt?: number;
};

type SlotType = {
  slotId: string;
  order: number;
  timeRange: string; // "HH:MM-HH:MM"
  theme: string;
  enabled: boolean;
  secondStageWanted?: boolean;
  // スロット単位で二段階投稿削除を有効にするか
  slotDeleteOnSecondStage?: boolean;
};

type ScheduleType = { start: string; end: string; theme: string };

type GroupModalProps = {
  open: boolean;
  onClose: () => void;
  // onSave may receive optional copySource when creating a new group
  onSave: (group: AutoPostGroupType, copySource?: string) => void;
  group: AutoPostGroupType | null;
  groups: AutoPostGroupType[];
};

// =======================
// APIエンドポイント
// =======================
const API = "/api/auto-post-groups";
const API_ITEMS = "/api/auto-post-group-items";

// [MOD] "07:00-09:30" → {start, end}。余分な空白をトリムして安全化
function parseTimeRange(time: string = "", theme: string = ""): ScheduleType {
  const [startRaw = "", endRaw = ""] = (time || "").split("-");
  const start = startRaw.trim();
  const end = endRaw.trim();
  return { start, end, theme: theme || "" };
}

// =======================
// グループ編集モーダル
// =======================
function GroupModal({
  open,
  onClose,
  onSave,
  group,
  groups,
}: GroupModalProps) {
  const isEdit = !!group?.groupKey;

  // [MOD] 初期値は空。実データは下の useEffect で毎回セットし直す
  const [groupName, setGroupName] = useState<string>("");
  const [schedule, setSchedule] = useState<ScheduleType[]>([{ start: "", end: "", theme: "" }]);
  const [copySource, setCopySource] = useState<string>("");

  // [ADD] モーダルを開いた/編集対象が変わったタイミングでフォームを再初期化
  useEffect(() => {
    if (!open) return;
    if (group && isEdit) {
      setGroupName(group.groupName || "");
      setSchedule([{ start: "", end: "", theme: "" }]);
    } else {
      setGroupName("");
      setSchedule([{ start: "", end: "", theme: "" }]);
    }
    setCopySource("");
  }, [open, group, isEdit]);

  // 既存の「複製」は不要になったため無効化
  useEffect(() => { /* no-op */ }, [copySource, groups]);

  function makeTimeRange(start: string, end: string): string {
    return start && end ? `${start}-${end}` : "";
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-xl shadow-xl p-8 w-full max-w-xl">
        <div className="flex justify-between items-center mb-4">
          <div className="text-lg font-bold">{isEdit ? "グループ編集" : "グループ追加"}</div>
          <button className="text-gray-400 hover:text-gray-700 text-2xl font-bold" onClick={onClose}>×</button>
        </div>
        <div className="mb-4">
          <label className="font-semibold block mb-1">自動投稿グループ名</label>
          <input
            className="border rounded p-2 w-full"
            value={groupName}
            onChange={e => setGroupName(e.target.value)}
          />
        </div>
        {/* グループ名のみ編集（スロットは展開行で編集） */}
        {!isEdit && (
          <div className="mb-4">
            <label className="font-semibold block mb-1">他グループから複製</label>
            <select
              className="border rounded p-2 w-full"
              value={copySource}
              onChange={e => setCopySource(e.target.value)}
            >
              <option value="">選択してください</option>
              {groups.map((g) => (
                <option key={g.groupKey} value={g.groupKey}>{g.groupName}</option>
              ))}
            </select>
          </div>
        )}
        <div className="flex justify-end mt-4">
          <button
            className="bg-blue-500 text-white px-6 py-2 rounded hover:bg-blue-600"
            onClick={() => {
              // pass copySource to onSave when creating new group
              onSave({ ...(isEdit && group ? { groupKey: group.groupKey } : {}), groupName } as AutoPostGroupType, copySource || undefined);
              onClose();
            }}
            disabled={!groupName.trim()}
          >
            {isEdit ? "保存" : "追加"}
          </button>
        </div>
      </div>
    </div>
  );
}

// =======================
// メインコンポーネント
// =======================
export default function AutoPostGroupsEditor() {
  const [groups, setGroups] = useState<AutoPostGroupType[]>([]);
  const [usedGroupKeys, setUsedGroupKeys] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editTarget, setEditTarget] = useState<AutoPostGroupType | null>(null);
  const [openGroupKey, setOpenGroupKey] = useState<string>("");
  const [slots, setSlots] = useState<Record<string, SlotType[]>>({});
  const [loadingSlots, setLoadingSlots] = useState<Record<string, boolean>>({});

  // 一覧取得
  const loadGroups = async () => {
    const res = await fetch(API, { credentials: "include" });
    const data = await res.json();
    setGroups(data.groups ?? []);
  };

  const loadSlots = async (groupKey: string) => {
    setLoadingSlots((s) => ({ ...s, [groupKey]: true }));
    try {
      const res = await fetch(`${API_ITEMS}?groupKey=${encodeURIComponent(groupKey)}`, { credentials: "include" });
      const data = await res.json();
      setSlots((s) => ({ ...s, [groupKey]: (data.items || []) as SlotType[] }));
    } finally {
      setLoadingSlots((s) => ({ ...s, [groupKey]: false }));
    }
  };

  // グループ一覧・使用中グループ取得
  useEffect(() => {
    fetch(API, { credentials: "include" })
      .then(res => res.json())
      .then(data => setGroups(data.groups ?? []));
    fetch("/api/threads-accounts", { credentials: "include" })
      .then(res => res.json())
      .then(data => {
        const list = (data.accounts ?? data.items ?? []) as Array<{ autoPostGroupId?: string }>; // [MOD] 両形式を許容
        const keys: string[] = list.map(a => a.autoPostGroupId).filter(Boolean) as string[];
        setUsedGroupKeys(keys);
      });
  }, []);

  const handleAdd = () => {
    setEditTarget(null);
    setModalOpen(true);
  };

  const handleEdit = (group: AutoPostGroupType) => {
    setEditTarget(group);
    setModalOpen(true);
  };

  const handleDelete = async (groupKey: string) => {
    if (!window.confirm("削除しますか？")) return;
    const res = await fetch(API, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ groupKey }),
    });
    const data = await res.json();
    if (data.success) {
      loadGroups();
    } else {
      alert("削除に失敗: " + (data.error || ""));
    }
  };

  // handleSave may receive optional copySource (when creating new group via modal)
  const handleSave = async (group: AutoPostGroupType, copySource?: string) => {
    const isCreate = !group.groupKey;
    const method = group.groupKey ? "PUT" : "POST";
    const newGroupKey = group.groupKey || `GROUP#${Date.now()}`;
    const body = {
      groupKey: newGroupKey,
      groupName: group.groupName,
      time1: "", theme1: "", time2: "", theme2: "", time3: "", theme3: "",
    };
    const res = await fetch(API, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.success) {
      alert("保存に失敗: " + (data.error || ""));
      return;
    }

    // If creating a new group and copySource is provided, duplicate slots from source
    if (isCreate && copySource) {
      try {
        const r = await fetch(`${API_ITEMS}?groupKey=${encodeURIComponent(copySource)}`, { credentials: "include" });
        if (r.ok) {
          const j = await r.json();
          const items = (j.items || []) as any[];
          for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const payload: any = {
              groupKey: newGroupKey,
              slotId: `CLONE#${Date.now()}${i}`,
              order: i,
              timeRange: it.timeRange || "",
              theme: it.theme || "",
              enabled: typeof it.enabled !== 'undefined' ? !!it.enabled : true,
              secondStageWanted: !!it.secondStageWanted,
            };
            await fetch(API_ITEMS, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(payload) });
          }
        }
      } catch (e) {
        console.log("group clone failed:", e);
      }
    }

    // reload groups after save/clone
    loadGroups();
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <GroupModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        group={editTarget}
        groups={groups}
      />

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold">自動投稿グループ管理</h2>
        <button
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          onClick={handleAdd}
        >
          ＋追加
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white dark:bg-gray-900 border">
          <thead>
            <tr>
              <th className="border p-1">自動投稿グループ名</th>
              <th className="border p-1">アクション</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group: AutoPostGroupType) => (
              <React.Fragment key={group.groupKey}>
                <tr>
                  <td className="border p-1">
                    <button
                      className="text-blue-600 underline mr-2"
                      onClick={() => {
                        const next = openGroupKey === group.groupKey ? "" : group.groupKey;
                        setOpenGroupKey(next);
                        if (next) loadSlots(group.groupKey);
                      }}
                    >
                      {openGroupKey === group.groupKey ? "▼" : "▶"} {group.groupName}
                    </button>
                  </td>
                  <td className="border p-1 space-x-1 text-right">
                    <button
                      className="bg-yellow-500 text-white px-2 py-1 rounded hover:bg-yellow-600"
                      onClick={() => handleEdit(group)}
                    >
                      グループ名編集
                    </button>
                    {!usedGroupKeys.includes(group.groupKey) && (
                      <button
                        className="bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"
                        onClick={() => handleDelete(group.groupKey)}
                      >
                        削除
                      </button>
                    )}
                  </td>
                </tr>
                {openGroupKey === group.groupKey && (
                  <tr>
                    <td colSpan={2} className="border p-0">
                      <SlotEditor
                        groupKey={group.groupKey}
                        items={slots[group.groupKey] || []}
                        loading={!!loadingSlots[group.groupKey]}
                        onReload={() => loadSlots(group.groupKey)}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {groups.length === 0 && (
              <tr>
                <td colSpan={2} className="text-center text-gray-500 p-4">
                  データがありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SlotEditor({ groupKey, items, loading, onReload }: { groupKey: string; items: SlotType[]; loading: boolean; onReload: () => void }) {
  const [rows, setRows] = useState<SlotType[]>(items);

  useEffect(() => setRows(items), [items]);

  const updateOrder = (index: number, dir: -1 | 1) => {
    const arr = [...rows];
    const j = index + dir;
    if (j < 0 || j >= arr.length) return;
    const a = arr[index];
    const b = arr[j];
    arr[index] = { ...b, order: a.order };
    arr[j] = { ...a, order: b.order };
    setRows(arr);
  };

  // Save all slots (create new / update existing) with validation
  const saveAll = async () => {
    // Validate enabled rows have timeRange and theme
    for (let i = 0; i < rows.length; i++) {
      const it = rows[i];
      if (!it.enabled) continue; // skip disabled rows
      const [s = "", e = ""] = (it.timeRange || "").split("-");
      if (!s || !e || !String(it.theme || "").trim()) {
        alert("未設定の時間帯や空のテーマがあります。すべての有効なスロットで時間帯とテーマを設定してください。");
        return;
      }
    }

    for (let i = 0; i < rows.length; i++) {
      const it = rows[i];
      const payload = { groupKey, slotId: it.slotId, timeRange: it.timeRange || "", theme: it.theme || "", enabled: !!it.enabled, secondStageWanted: !!it.secondStageWanted, order: i };
      if (String(it.slotId).startsWith("tmp-")) {
        await fetch(API_ITEMS, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(payload) });
      } else {
        await fetch(API_ITEMS, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(payload) });
      }
    }
    onReload();
  };

  // per-row save removed: use saveAll to persist all slots at once

  const deleteRow = async (slotId: string) => {
    if (!window.confirm("スロットを削除しますか？")) return;
    await fetch(API_ITEMS, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ groupKey, slotId }),
    });
    onReload();
  };

  // Add a temporary local row (not immediately persisted) so unsaved fields are preserved
  const addRow = () => {
    const id = `tmp-${Date.now()}`;
    const newRow: SlotType = { slotId: id, order: rows.length, timeRange: "", theme: "", enabled: true };
    setRows((r) => [...r, newRow]);
  };

  const setField = (i: number, key: keyof SlotType, value: any) => {
    const arr = [...rows];
    (arr[i] as any)[key] = value;
    setRows(arr);
  };

  return (
    <div className="p-3 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100">
      <div className="flex justify-between items-center mb-2">
        <div className="font-semibold">スロット（最大10件）</div>
        <div className="space-x-2">
          <button className="bg-green-600 text-white px-3 py-1 rounded" onClick={addRow}>＋追加</button>
          <button className="bg-blue-600 text-white px-3 py-1 rounded" onClick={saveAll}>保存</button>
        </div>
      </div>
      {loading ? (
        <div className="text-gray-500">読み込み中...</div>
      ) : rows.length === 0 ? (
        <div className="text-gray-500">スロットがありません</div>
      ) : (
        <table className="w-full bg-white dark:bg-gray-900 border">
          <thead className="dark:bg-gray-800">
            <tr>
              <th className="border p-1 w-20">順序</th>
              <th className="border p-1 w-28">時間帯</th>
              <th className="border p-1 w-96">テーマ</th>
              <th className="border p-1 w-20">二段階投稿</th>
              <th className="border p-1 w-20">有効</th>
              <th className="border p-1 w-28">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((it, i) => {
              const [start = "", end = ""] = (it.timeRange || "").split("-");
              return (
                <tr key={it.slotId}>
                  <td className="border p-1 text-center space-x-1">
                    <button className="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded" onClick={() => updateOrder(i, -1)}>↑</button>
                    <button className="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded" onClick={() => updateOrder(i, +1)}>↓</button>
                  </td>
                  <td className="border p-1">
                    <div className="flex flex-col items-center gap-1">
                      <input type="time" className="border rounded p-1 w-24"
                        value={start}
                        onChange={(e) => setField(i, 'timeRange', `${e.target.value}-${end}`)} />
                      <span className="text-xs">〜</span>
                      <input type="time" className="border rounded p-1 w-24"
                        value={end}
                        onChange={(e) => setField(i, 'timeRange', `${start}-${e.target.value}`)} />
                    </div>
                  </td>
                  <td className="border p-1">
                    <textarea className="border rounded p-2 w-full min-h-[40px]" value={it.theme}
                      onChange={(e) => setField(i, 'theme', e.target.value)} />
                  </td>
                  <td className="border p-1 text-center">
                    <input type="checkbox" checked={!!it.secondStageWanted} onChange={(e) => setField(i, 'secondStageWanted', e.target.checked)} />
                  </td>
                  {/* slot-level delete flag removed from UI; use group slot secondStageWanted + global settings */}
                  <td className="border p-1 text-center">
                    <input type="checkbox" checked={it.enabled}
                      onChange={(e) => setField(i, 'enabled', e.target.checked)} />
                  </td>
                  <td className="border p-1 text-center">
                    <div className="inline-flex gap-2">
                      <button className="bg-red-600 text-white px-3 py-1 rounded" onClick={() => deleteRow(it.slotId)}>削除</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
