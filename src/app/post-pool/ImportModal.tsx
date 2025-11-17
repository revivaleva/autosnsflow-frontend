"use client";

import React, { useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onImport?: (items: string[]) => Promise<void> | void;
  maxLen?: number;
};

export default function ImportModal({ open, onClose, onImport, maxLen = 140 }: Props) {
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [text, setText] = useState("");
  const [items, setItems] = useState<Array<{ text: string; selected: boolean; len: number }>>([]);
  const [selectAll, setSelectAll] = useState(true);
  const [importing, setImporting] = useState(false);

  if (!open) return null;

  const parseText = (t: string) => {
    // 分割は半角カンマを区切りとする（本文中の改行はそのまま残る）
    const raw = t.split(",").map(s => s.trim());
    const filtered = raw.filter(s => s !== "");
    const mapped = filtered.map(s => ({ text: s, selected: true, len: String(s).length }));
    setItems(mapped);
    setSelectAll(true);
  };

  const handleFile = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const v = String(r.result || "");
      setText(v);
      parseText(v);
    };
    r.readAsText(f, "utf-8");
  };

  const handlePasteParse = () => {
    parseText(text);
  };

  const toggleSelectAll = () => {
    const next = !selectAll;
    setSelectAll(next);
    setItems(itms => itms.map(i => ({ ...i, selected: next })));
  };

  const toggleItem = (idx: number) => {
    setItems(itms => itms.map((it, i) => i === idx ? { ...it, selected: !it.selected } : it));
  };

  const doImport = async () => {
    const selected = items.filter(i => i.selected).map(i => i.text);
    if (selected.length === 0) {
      alert("取り込む行が選択されていません");
      return;
    }
    try {
      setImporting(true);
      if (onImport) await onImport(selected);
    } catch (e) {
      console.error('import failed', e);
      alert('取り込み中にエラーが発生しました: ' + String(e));
    } finally {
      setImporting(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl bg-white dark:bg-gray-800 rounded shadow p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">CSV / テキスト取り込み</h3>
          <button className="text-sm text-gray-600" onClick={onClose}>閉じる</button>
        </div>

        <div className="mb-3">
          <div className="flex gap-2">
            <button className={`px-3 py-1 rounded ${mode === 'file' ? 'bg-gray-200' : 'bg-transparent'}`} onClick={() => setMode("file")}>ファイル</button>
            <button className={`px-3 py-1 rounded ${mode === 'paste' ? 'bg-gray-200' : 'bg-transparent'}`} onClick={() => setMode("paste")}>貼り付け</button>
          </div>
        </div>

        {mode === "file" ? (
          <div className="mb-3">
            <input type="file" accept=".csv,.txt" onChange={handleFile} />
          </div>
        ) : (
          <div className="mb-3">
            <textarea className="w-full border rounded p-2 min-h-[120px] bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" value={text} onChange={(e) => setText(e.target.value)} placeholder="ここにCSVの内容を貼り付け（カンマ区切り）。改行は本文内に保持されます。"></textarea>
            <div className="mt-2">
              <button className="bg-blue-500 text-white px-3 py-1 rounded" onClick={handlePasteParse}>解析してプレビュー</button>
            </div>
          </div>
        )}

        <div className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm">プレビュー（{items.length}件）</div>
            <div className="flex items-center gap-2">
              <label className="text-sm">選択: </label>
              <button className="px-2 py-1 border rounded text-sm" onClick={toggleSelectAll}>{selectAll ? '全解除' : '全選択'}</button>
            </div>
          </div>
          <div className="max-h-64 overflow-auto border rounded">
            <table className="min-w-full">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-left w-12">#</th>
                  <th className="p-2 text-left">本文（プレビュー）</th>
                  <th className="p-2 text-right w-24">文字数</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="p-2">
                      <input type="checkbox" checked={it.selected} onChange={() => toggleItem(idx)} />
                    </td>
                    <td className="p-2">
                      <div style={{ whiteSpace: 'pre-wrap' }} className="text-sm">{it.text}</div>
                    </td>
                    <td className="p-2 text-right">
                      <div className={it.len > (maxLen || 140) ? 'text-red-600 font-semibold' : 'text-gray-600'}>{it.len}</div>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={3} className="p-4 text-center text-gray-500">プレビューがありません</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

          <div className="flex justify-end gap-2">
          <button className="px-3 py-1 border rounded" onClick={onClose} disabled={importing}>キャンセル</button>
          <button className="bg-green-500 text-white px-3 py-1 rounded" onClick={doImport} disabled={importing}>{importing ? '取り込み中...' : '取り込み（プレビュー行を登録）'}</button>
        </div>
      </div>
    </div>
  );
}


