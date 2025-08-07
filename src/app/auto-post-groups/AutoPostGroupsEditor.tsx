// src/ui-components/AutoPostGroupsEditor.jsx

"use client";

import React, { useState, useEffect } from "react";

// APIエンドポイント
const API = "/api/auto-post-groups";

// ユーザーID取得ヘルパー
const getUserId = () =>
  typeof window !== "undefined" ? localStorage.getItem("userId") : "";

// APIで取得・登録するデータの型：
// groupKey, groupName, time1, theme1, time2, theme2, time3, theme3
function parseTimeRange(time = "", theme = "") {
  // "07:00-09:30" → {start: "07:00", end: "09:30"}
  const [start = "", end = ""] = (time || "").split("-");
  return { start, end, theme: theme || "" };
}

function GroupModal({ open, onClose, onSave, group, groups }) {
  const isEdit = !!group?.groupKey;
  const [groupName, setGroupName] = useState(group?.groupName || "");
  const [schedule, setSchedule] = useState([
    { start: "", end: "", theme: "" },
    { start: "", end: "", theme: "" },
    { start: "", end: "", theme: "" },
  ]);
  const [copySource, setCopySource] = useState("");

  useEffect(() => {
    if (!copySource) return;
    // 選択したgroupKeyでグループを探す
    const src = groups.find(g => g.groupKey === copySource);
    if (src) {
      setSchedule([
        parseTimeRange(src.time1, src.theme1),
        parseTimeRange(src.time2, src.theme2),
        parseTimeRange(src.time3, src.theme3),
      ]);
    }
  }, [copySource, groups]);

  function parseTimeRange(time = "", theme = "") {
    // "07:00-09:30" → {start: "07:00", end: "09:30"}
    const [start = "", end = ""] = (time || "").split("-");
    return { start, end, theme: theme || "" };
  }

  function makeTimeRange(start, end) {
    return start && end ? `${start}-${end}` : "";
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-8 w-full max-w-xl">
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
        <div className="mb-4 flex flex-col gap-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="border rounded-lg p-4 bg-gray-50 flex flex-col gap-2">
              <div className="flex gap-4 items-center">
                <span className="font-bold w-16">時刻{i+1}</span>
                <input
                  type="time"
                  className="border rounded p-1 w-28"
                  value={schedule[i]?.start || ""}
                  onChange={e => {
                    const newSch = [...schedule];
                    newSch[i].start = e.target.value;
                    setSchedule(newSch);
                  }}
                />
                <span className="mx-1 text-sm">〜</span>
                <input
                  type="time"
                  className="border rounded p-1 w-28"
                  value={schedule[i]?.end || ""}
                  onChange={e => {
                    const newSch = [...schedule];
                    newSch[i].end = e.target.value;
                    setSchedule(newSch);
                  }}
                />
              </div>
              <div className="flex flex-col mt-1">
                <label className="font-bold text-sm mb-1">テーマ{i+1}</label>
                <textarea
                  className="border rounded p-2 w-full min-h-[48px] resize-y"
                  value={schedule[i]?.theme || ""}
                  onChange={e => {
                    const newSch = [...schedule];
                    newSch[i].theme = e.target.value;
                    setSchedule(newSch);
                  }}
                  placeholder="テーマを入力"
                  rows={2}
                />
              </div>
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
              {groups.map(g => (
                <option key={g.groupKey} value={g.groupKey}>{g.groupName}</option>
              ))}
            </select>
          </div>
        )}
        <div className="flex justify-end mt-4">
          <button
            className="bg-blue-500 text-white px-6 py-2 rounded hover:bg-blue-600"
            onClick={() => {
              onSave({
                ...(isEdit ? { groupKey: group.groupKey } : {}),
                groupName,
                time1: makeTimeRange(schedule[0].start, schedule[0].end),
                theme1: schedule[0].theme || "",
                time2: makeTimeRange(schedule[1].start, schedule[1].end),
                theme2: schedule[1].theme || "",
                time3: makeTimeRange(schedule[2].start, schedule[2].end),
                theme3: schedule[2].theme || "",
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
  const [groups, setGroups] = useState([]);
  const [usedGroupKeys, setUsedGroupKeys] = useState([]); // 追加
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  // 一覧取得
  const loadGroups = async () => {
    const userId = getUserId();
    if (!userId) return;
    const res = await fetch(`${API}?userId=${userId}`);
    const data = await res.json();
    setGroups(data.groups ?? []);
  };

  // グループ一覧・使用中グループ取得
  useEffect(() => {
    const userId = localStorage.getItem("userId");
    // グループ一覧
    fetch(`/api/auto-post-groups?userId=${userId}`)
      .then(res => res.json())
      .then(data => setGroups(data.groups ?? []));
    // SNSアカウント一覧→使用中グループ取得
    fetch(`/api/threads-accounts?userId=${userId}`)
      .then(res => res.json())
      .then(data => {
        // autoPostGroupId でまとめる（空でないもの）
        const keys = (data.accounts ?? [])
          .map(a => a.autoPostGroupId)
          .filter(Boolean);
        setUsedGroupKeys(keys);
      });
  }, []);

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
  const handleDelete = async (groupKey) => {
    if (!window.confirm("削除しますか？")) return;
    const userId = getUserId();
    // フロントで紐づきチェック済みの場合のみ許可（ここでは未実装）
    const res = await fetch(API, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, groupKey }),
    });
    const data = await res.json();
    if (data.success) {
      loadGroups();
    } else {
      alert("削除に失敗: " + (data.error || ""));
    }
  };

  // 追加・編集保存
  const handleSave = async (group) => {
    const userId = getUserId();
    const method = group.groupKey ? "PUT" : "POST";
    const body = {
      userId,
      groupKey: group.groupKey || `GROUP#${Date.now()}`,
      groupName: group.groupName,
      time1: group.time1,
      theme1: group.theme1,
      time2: group.time2,
      theme2: group.theme2,
      time3: group.time3,
      theme3: group.theme3,
    };
    const res = await fetch(API, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.success) {
      loadGroups();
    } else {
      alert("保存に失敗: " + (data.error || ""));
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
              <tr key={group.groupKey}>
                <td className="border p-1">{group.groupName}</td>
                <td className="border p-1">{group.time1}</td>
                <td className="border p-1">{group.theme1}</td>
                <td className="border p-1">{group.time2}</td>
                <td className="border p-1">{group.theme2}</td>
                <td className="border p-1">{group.time3}</td>
                <td className="border p-1">{group.theme3}</td>
                <td className="border p-1 space-x-1">
                  <button
                    className="bg-yellow-500 text-white px-2 py-1 rounded hover:bg-yellow-600"
                    onClick={() => handleEdit(group)}
                  >
                    編集
                  </button>
                  {!usedGroupKeys.includes(group.groupKey) && (
                    <button
                      className="bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"
                      onClick={() => handleDelete(group.groupKey)}
                    >削除</button>
                  )}
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
