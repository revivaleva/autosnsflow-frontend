// src/ui-components/AutoPostGroupsEditor.jsx

"use client";

import React, { useState } from "react";

// サンプル初期データ
const initialGroups = [
  {
    id: "group1",
    groupName: "朝昼夕グループ",
    schedule: [
      { time: "08:00", theme: "おはよう" },
      { time: "12:00", theme: "ランチ" },
      { time: "18:00", theme: "お疲れ様" },
    ],
  },
  {
    id: "group2",
    groupName: "深夜グループ",
    schedule: [
      { time: "23:00", theme: "寝る前のひとこと" },
      { time: "", theme: "" },
      { time: "", theme: "" },
    ],
  },
];

// 追加・編集モーダル
function GroupModal({ open, onClose, onSave, group, groups }) {
  const isEdit = !!group?.id;
  const [groupName, setGroupName] = useState(group?.groupName || "");
  const [schedule, setSchedule] = useState(
    group?.schedule
      ? [...group.schedule]
      : [
          { time: "", theme: "" },
          { time: "", theme: "" },
          { time: "", theme: "" },
        ]
  );
  const [copySource, setCopySource] = useState("");

  // 複製
  const handleCopy = (groupId) => {
    const src = groups.find((g) => g.id === groupId);
    if (src) {
      setSchedule(JSON.parse(JSON.stringify(src.schedule)));
    }
  };

  React.useEffect(() => {
    if (copySource) handleCopy(copySource);
    // eslint-disable-next-line
  }, [copySource]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-8 w-full max-w-lg">
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
        <div className="mb-4 flex flex-col gap-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="flex gap-2 items-center">
              <span className="text-sm font-bold w-24">時刻{i+1}</span>
              <input
                type="time"
                className="border rounded p-1 flex-1"
                value={schedule[i]?.time || ""}
                onChange={e => {
                  const newSch = [...schedule];
                  newSch[i].time = e.target.value;
                  setSchedule(newSch);
                }}
              />
              <span className="text-sm font-bold w-24">テーマ{i+1}</span>
              <input
                className="border rounded p-1 flex-1"
                value={schedule[i]?.theme || ""}
                onChange={e => {
                  const newSch = [...schedule];
                  newSch[i].theme = e.target.value;
                  setSchedule(newSch);
                }}
                placeholder="例: おはよう"
              />
            </div>
          ))}
        </div>
        {!isEdit && (
          <div className="mb-4">
            <label className="font-semibold block mb-1">他グループから複製</label>
            <select
              className="border rounded p-2 w-full"
              value={copySource}
              onChange={e => setCopySource(e.target.value)}
            >
              <option value="">選択してください</option>
              {groups.filter(g => !group || g.id !== group.id).map(g => (
                <option key={g.id} value={g.id}>{g.groupName}</option>
              ))}
            </select>
          </div>
        )}
        <div className="flex justify-end mt-4">
          <button
            className="bg-blue-500 text-white px-6 py-2 rounded hover:bg-blue-600"
            onClick={() => {
              onSave({
                ...group,
                groupName,
                schedule: schedule.map(s => ({
                  time: s.time || "",
                  theme: s.theme || ""
                }))
              });
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

export default function AutoPostGroupsEditor() {
  const [groups, setGroups] = useState(initialGroups);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  // 追加
  const handleAdd = () => {
    setEditTarget(null);
    setModalOpen(true);
  };

  // 編集
  const handleEdit = (group) => {
    setEditTarget(group);
    setModalOpen(true);
  };

  // 削除
  const handleDelete = (id) => {
    if (window.confirm("削除しますか？")) {
      setGroups(groups.filter(g => g.id !== id));
    }
  };

  // 追加・編集保存
  const handleSave = (group) => {
    if (group.id) {
      setGroups(groups.map(g => g.id === group.id ? group : g));
    } else {
      setGroups([...groups, { ...group, id: `group${Date.now()}` }]);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
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
        <table className="min-w-full bg-white border">
          <thead>
            <tr>
              <th className="border p-1">自動投稿グループ名</th>
              <th className="border p-1">時刻1</th>
              <th className="border p-1">テーマ1</th>
              <th className="border p-1">時刻2</th>
              <th className="border p-1">テーマ2</th>
              <th className="border p-1">時刻3</th>
              <th className="border p-1">テーマ3</th>
              <th className="border p-1">アクション</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(group => (
              <tr key={group.id}>
                <td className="border p-1">{group.groupName}</td>
                <td className="border p-1">{group.schedule[0]?.time}</td>
                <td className="border p-1">{group.schedule[0]?.theme}</td>
                <td className="border p-1">{group.schedule[1]?.time}</td>
                <td className="border p-1">{group.schedule[1]?.theme}</td>
                <td className="border p-1">{group.schedule[2]?.time}</td>
                <td className="border p-1">{group.schedule[2]?.theme}</td>
                <td className="border p-1 space-x-1">
                  <button
                    className="bg-yellow-500 text-white px-2 py-1 rounded hover:bg-yellow-600"
                    onClick={() => handleEdit(group)}
                  >
                    編集
                  </button>
                  <button
                    className="bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"
                    onClick={() => handleDelete(group.id)}
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
            {groups.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-gray-500 p-4">
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
