"use client";

import React, { useState, useEffect } from "react";
import { getAuthReady, refreshAuthReady } from '@/lib/authReady';
import LoadingOverlay from '@/components/LoadingOverlay';
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
  /** 監視対象となる外部アカウントID（引用投稿の取得に使用） */
  monitoredAccountId?: string;
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

// AccountCopyModal implementation moved to `src/app/accounts/AccountCopyModal.tsx` (local duplicate removed)

export default function SNSAccountModal({
  open,
  onClose,
  mode = "create",
  account,
  reloadAccounts,
}: SNSAccountModalProps) {
  const emptyPersona = {
    name: "",
    age: "",
    gender: "",
    job: "",
    lifestyle: "",
    character: "",
    tone: "",
    vocab: "",
    emotion: "",
    erotic: "",
    target: "",
    purpose: "",
    distance: "",
    ng: "",
  };

  const [displayName, setDisplayName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [clientSecretMasked, setClientSecretMasked] = useState(false);
  // 保持: 表示時に DB から取得した clientId と secret の存在フラグ
  const [originalClientId, setOriginalClientId] = useState("");
  const [originalHasClientSecret, setOriginalHasClientSecret] = useState(false);
  const [characterImage, setCharacterImage] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [authReady, setAuthReady] = useState<boolean>(getAuthReady());
  const [groupId, setGroupId] = useState("");
  const [groups, setGroups] = useState<AutoPostGroupType[]>([]);
  const [persona, setPersona] = useState<PersonaType>(emptyPersona);
  const [personaMode, setPersonaMode] = useState("detail");
  const [personaSimple, setPersonaSimple] = useState("");
  /** ▼追加: 2段階投稿テキスト */
  const [secondStageContent, setSecondStageContent] = useState(""); // ← 追加
  const [monitoredAccountId, setMonitoredAccountId] = useState("");
  const [quoteTimeStart, setQuoteTimeStart] = useState("");
  const [quoteTimeEnd, setQuoteTimeEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [authUrlFallback, setAuthUrlFallback] = useState<string | null>(null);
  const [aiPreviewModalOpen, setAiPreviewModalOpen] = useState(false);
  const [aiPersonaDetail, setAiPersonaDetail] = useState("");
  const [aiPersonaSimple, setAiPersonaSimple] = useState("");
  // preview for fetched posts when doing immediate delete count
  const [previewPosts, setPreviewPosts] = useState<any[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  // deletionMessage removed from UI; keep only for potential future use
  const [deletionMessage, setDeletionMessage] = useState<string | null>(null);
  const [deletionExecuted, setDeletionExecuted] = useState(false);
  const [bulkPersonaOpen, setBulkPersonaOpen] = useState(false);
  const [bulkPersonaText, setBulkPersonaText] = useState("");

  // グループ一覧の取得
  useEffect(() => {
    if (!open) return;
    fetch(`/api/auto-post-groups`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setGroups(data.groups ?? []));
    // refresh auth readiness when modal opens
    (async () => {
      const ok = await refreshAuthReady();
      setAuthReady(ok);
    })();
  }, [open]);

  useEffect(() => {
    if (mode === "edit" && account) {
      setDisplayName(account.displayName || "");
      setAccountId(account.accountId || "");
      setAccessToken(account.accessToken || "");
      // clientId may be stored under different keys depending on migration; try several fallbacks
      setClientId(
        account.clientId || account.client_id || account.CLIENT_ID || (account?.client && account.client.id) || ""
      );

      // For security, do not preload actual clientSecret into the editable field.
      // API may return clientSecret (legacy) or hasClientSecret flag; check both.
      const hasSecret = !!(
        account.clientSecret || account.client_secret || account.hasClientSecret || account.has_client_secret || (account?.client && account.client.secret)
      );
      setClientSecret("");
      setClientSecretMasked(hasSecret);
      // store original values for change-detection
      setOriginalClientId(
        account.clientId || account.client_id || account.CLIENT_ID || (account?.client && account.client.id) || ""
      );
      setOriginalHasClientSecret(hasSecret);
      setGroupId(account.autoPostGroupId || "");
      // ▼【追加】不正なJSON文字列で落ちないようガード
      try {
        setPersona(account.personaDetail ? JSON.parse(account.personaDetail) : { ...emptyPersona }); // 【追加】
      } catch {
        setPersona({ ...emptyPersona }); // 【追加】
      }
      setCharacterImage(account.characterImage || "");
      setPersonaMode(account.personaMode === "simple" ? "simple" : "detail");
      setPersonaSimple(account.personaSimple || "");
      setSecondStageContent(account.secondStageContent || ""); // ← 追加
      setMonitoredAccountId(account.monitoredAccountId || "");
      setQuoteTimeStart(account.quoteTimeStart || "");
      setQuoteTimeEnd(account.quoteTimeEnd || "");
    } else if (mode === "create") {
      setDisplayName("");
      setAccountId("");
      setAccessToken("");
      setClientId("");
      setClientSecret("");
      setClientSecretMasked(false);
      setOriginalClientId("");
      setOriginalHasClientSecret(false);
      setGroupId("");
      setPersonaMode("detail");
      setPersonaSimple("");
      setPersona({ ...emptyPersona });
      setCharacterImage("");
      setSecondStageContent(""); // ← 追加
      setMonitoredAccountId("");
      setQuoteTimeStart("");
      setQuoteTimeEnd("");
    }
    setError("");
  }, [account, mode]);

  // 変更判定: clientId が変わったか、clientSecret が編集モードになった or 元が空で新規入力されたか
  function areCredentialsModified(): boolean {
    try {
      const idChanged = (originalClientId || "").trim() !== (clientId || "").trim();
      const secretChanged =
        (clientSecretMasked === false) || // マスク解除して編集可能にした = 変更意図あり
        (!originalHasClientSecret && (clientSecret || "").trim() !== ""); // 元が空で入力がある
      return idChanged || secretChanged;
    } catch (e) {
      return false;
    }
  }

  const handlePersonaChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setPersona({ ...persona, [e.target.name]: e.target.value });

  const handleCopyAccountData = (acc: any) => {
    // ペルソナ情報と投稿グループのみ上書きし、その他の入力値は保持する
    setGroupId(acc.autoPostGroupId || acc.auto_post_group_id || "");
    setPersonaMode(acc.personaMode || "detail");
    setPersonaSimple(acc.personaSimple || "");
    // コピー元のJSONを安全に取り込む
    try {
      const detail = acc.personaDetail ?? acc.persona_detail ?? acc.persona;
      if (typeof detail === "string") {
        setPersona(detail.trim() === "" ? { ...emptyPersona } : JSON.parse(detail));
      } else if (typeof detail === "object" && detail !== null) {
        setPersona({ ...emptyPersona, ...(detail || {}) });
      } else {
        setPersona({ ...emptyPersona });
      }
    } catch {
      setPersona({ ...emptyPersona });
    }
    setCopyModalOpen(false);
  };

  const handleAIGenerate = async () => {
    setAiLoading(true);
    // ensure auth ready to avoid token race
    if (!authReady) {
      const ok = await refreshAuthReady();
      setAuthReady(ok);
      if (!ok) {
        setAiLoading(false);
        setError("認証情報が確認できません。しばらく待ってから再試行してください。");
        return;
      }
    }
    setError("");
    setAiPersonaDetail("");
    setAiPersonaSimple("");
    try {
      // ▼【追加】空入力の早期バリデーション
      if (!characterImage.trim()) {
        setAiLoading(false);
        setError("キャラクターイメージを入力してください。"); // 【追加】
        return;
      }

      const res = await fetch("/api/ai-gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          purpose: "persona-generate",
          input: { personaSeed: characterImage || "" },
        }),
      });

      // ▼【追加】非200時の詳細メッセージを拾う
      const data = await res.json().catch(() => ({} as any)); // 【追加】
      setAiLoading(false);

      if (!res.ok) {
        const msg = (data as any)?.error || (data as any)?.message || "AI生成に失敗しました"; // 【追加】
        setError(msg); // 【追加】
        return;
      }

      if ((data as any).error) {
        setError((data as any).error);
        return;
      }

      setAiPersonaDetail((data as any).personaDetail || "");
      setAiPersonaSimple((data as any).personaSimple || "");
      setAiPreviewModalOpen(true);
    } catch (e) {
      setError("AI生成エラー: " + String(e));
      setAiLoading(false);
    }
  };

  const handleApplyAIPersona = ({ personaDetail, personaSimple }: AIPersonaPayload) => {
    // ▼【追加】文字列JSONのまま渡ってきても安全に取り込む
    try {
      const obj =
        typeof personaDetail === "string" && personaDetail.trim()
          ? JSON.parse(personaDetail)
          : personaDetail || {};
      setPersona({ ...emptyPersona, ...(obj || {}) });
    } catch {
      setPersona({ ...emptyPersona });
    }
    setPersonaSimple(personaSimple || "");
    setAiPreviewModalOpen(false);
  };

  // ペルソナ一括貼付の処理を外だしして JSX 内の複雑な表現を避ける
  const applyBulkPersona = () => {
    const mapping: Record<string, keyof PersonaType> = {
      名前: "name",
      年齢: "age",
      性別: "gender",
      職業: "job",
      生活スタイル: "lifestyle",
      投稿キャラ: "character",
      "口調・内面": "tone",
      語彙傾向: "vocab",
      "感情パターン": "emotion",
      エロ表現: "erotic",
      ターゲット層: "target",
      投稿目的: "purpose",
      "絡みの距離感": "distance",
      NG要素: "ng",
    };
    const lines = String(bulkPersonaText || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const newPersona = { ...persona } as any;
    for (const line of lines) {
      const parts = line.split(/\t|\s*:\s*|\s+/, 2).map(p => p.trim());
      if (parts.length < 2) continue;
      const key = parts[0];
      const val = parts[1];
      const field = mapping[key];
      if (field) newPersona[field] = val;
    }
    setPersona(newPersona);
    setBulkPersonaOpen(false);
    setBulkPersonaText("");
  };

  const originalAccountId = account?.accountId;

  // [ADD] 削除ハンドラ（編集時のみ使用）
  const handleDelete = async () => {
    if (!originalAccountId) return;
    if (!confirm("このアカウントを削除します。よろしいですか？")) return;
    try {
      const res = await fetch("/api/threads-accounts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accountId: originalAccountId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) throw new Error(data?.error || "delete failed");
      // show success alert then refresh list and close modal
      try { alert('アカウントを削除しました'); } catch {}
      await reloadAccounts();
      onClose();
    } catch (e: any) {
      alert("削除に失敗しました: " + (e?.message || e));
    }
  };

  // 投稿全削除ハンドラ（編集時のみ使用） — 二重確認ダイアログを表示
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingLoading, setDeletingLoading] = useState(false);
  // preview removed per user request
  

  const handleDeleteAllPosts = () => {
    if (!originalAccountId) return;
    setShowDeleteConfirm(true);
  };

  const doImmediateDelete = async () => {
    if (!originalAccountId) return;
    if (!confirm("本当に全投稿を即時で削除します。取り消せません。\n即時削除は非常に時間がかかります。裏画面実行を使用することをおすすめします。続行しますか？")) return;
    // close confirm and show loading overlay in edit modal
    setShowDeleteConfirm(false);
    setDeletingLoading(true);
    try {
      // debug log removed
      setDeletionMessage(null);
      const res = await fetch(`/api/accounts/${encodeURIComponent(originalAccountId)}/delete-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode: 'immediate' }),
      });
      const text = await res.text().catch(() => '');
      // debug log removed
      let data: any = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { rawText: text }; }
      // server-side logs will contain debug info; keep UI unchanged
      // debug logs removed - do not log tokens or responses in client code
      if (!res.ok || data?.error) throw new Error(data?.error || "delete-all failed");
      if (data?.status === 'count') {
        const n = Number(data?.totalCandidates || 0);
        const fetched = Number(data?.fetchedCount || 0);
        // show blocking native alert as requested
        const msg = `取得件数: ${fetched} 件\n候補合計: ${n} 件`;
        try { alert(msg); } catch (e) { console.warn('alert failed', e); }
        // mark executed so closing modal triggers reload
        setDeletionExecuted(true);
        // try to load preview posts but do not block or alert
        try {
          const postsRes = await fetch(`/api/accounts/${encodeURIComponent(originalAccountId)}/fetch-posts?limit=${fetched}`, { credentials: 'include' });
          const postsJson = await postsRes.json().catch(() => ({}));
          if (postsRes.ok && postsJson?.posts) {
            setPreviewPosts(postsJson.posts || []);
            setPreviewOpen(true);
          }
        } catch (e) {
        // debug warn removed
        }
      } else if (data?.status === 'no_posts') {
        // debug log removed
        const msgNo = '削除対象の投稿はありませんでした';
        try { alert(msgNo); } catch (e) { console.warn('alert failed', e); }
        setDeletionExecuted(true);
      } else {
        console.log('[client] delete-all started', { body: data });
        if (data?.status === 'queued') {
          // immediate deletion couldn't finish all items; instruct user about background processing
          const msgQueued = '上限を超えたため削除できなかった投稿があります。残数は裏画面で実行します。';
          try { alert(msgQueued); } catch (e) { console.warn('alert failed', e); }
        } else if (data?.status === 'completed') {
          const msgDone = 'すべての投稿の削除が完了しました';
          try { alert(msgDone); } catch (e) { console.warn('alert failed', e); }
        } else {
          const msgStart = data?.message || '投稿削除の処理を開始しました';
          try { alert(msgStart); } catch (e) { console.warn('alert failed', e); }
        }
        setDeletionExecuted(true);
      }
      // keep modal open; do not auto-refresh the accounts list here
    } catch (e: any) {
      // debug error removed
      alert("投稿全削除に失敗しました: " + (e?.message || e));
    } finally {
      // debug log removed
      setDeletingLoading(false);
    }
  };


  const doBackgroundDelete = async () => {
    if (!originalAccountId) return;
    if (!confirm("裏画面で削除処理を開始します。よろしいですか？")) return;
    setShowDeleteConfirm(false);
    setDeletingLoading(true);
    try {
      // debug log removed
      const res = await fetch(`/api/accounts/${encodeURIComponent(originalAccountId)}/delete-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode: 'background' }),
      });
      const text = await res.text().catch(() => '');
      // debug log removed
      let data: any = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { rawText: text }; }
      if (!res.ok || data?.error) throw new Error(data?.error || "queue failed");
      if (data?.status === 'queued') {
        // do not show counts for background; show generic started message
        alert('削除を開始しました。');
        setDeletionExecuted(true);
      } else {
        alert(data?.message || '削除を開始しました。');
        setDeletionExecuted(true);
      }
      // keep modal open; do not auto-refresh the accounts list here
    } catch (e: any) {
      // debug error removed
      alert("裏画面実行に失敗しました: " + (e?.message || e));
    } finally {
      // debug log removed
      setDeletingLoading(false);
    }
  };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    if (!displayName || !accountId) {
      setError("アカウント名・IDは必須です");
      setSaving(false);
      return;
    }
    // clientId/clientSecret 必須組合せチェック: どちらか一方のみ入力されている場合は保存不可
    try {
      const hasClientId = Boolean(String(clientId || "").trim());
      // clientSecretMasked が true の場合は既存のシークレットが存在するとみなす
      const hasClientSecret = clientSecretMasked ? true : Boolean(String(clientSecret || "").trim());
      if (hasClientId !== hasClientSecret) {
        const msg = "clientId と clientSecret は両方入力するか両方空にしてください。片方だけでは保存できません。";
        // 明示的なアラートで同期的にユーザーに伝える
        alert(msg);
        setError(msg);
        setSaving(false);
        return;
      }
    } catch (e) {
      // ignore
    }
      try {
        // 編集時にIDが変わった場合は旧データを削除
        if (mode === "edit" && originalAccountId && originalAccountId !== accountId) {
          await fetch("/api/threads-accounts", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ accountId: originalAccountId }),
          });
        }

        // 新規作成時: 同一 accountId の存在チェック（失敗しても続行）
        if (mode === "create") {
          try {
            await fetch(`/api/threads-accounts?accountId=${encodeURIComponent(accountId)}`, { method: "GET", credentials: "include" });
          } catch (_) {
            // ignore
          }
        }
      const method = mode === "create" ? "POST" : "PUT";
      const res = await fetch("/api/threads-accounts", {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
          body: JSON.stringify({
          accountId,
          displayName,
          accessToken: accessToken,
          clientId: clientId || undefined,
          clientSecret: clientSecret || undefined,
          createdAt:
            mode === "create"
              ? Math.floor(Date.now() / 1000)
              : account?.createdAt ?? Math.floor(Date.now() / 1000),
          personaDetail: JSON.stringify(persona),
          personaSimple: personaSimple,
          personaMode: personaMode,
          autoPostGroupId: groupId,
          characterImage: characterImage || "",
          /** ▼追加送信: 2段階投稿テキスト */
          secondStageContent: secondStageContent || "", // ← 追加
          monitoredAccountId: monitoredAccountId || "",
          quoteTimeStart: quoteTimeStart || "",
          quoteTimeEnd: quoteTimeEnd || "",
        }),
      });
      // [FIX] 成否判定を res.ok / data.ok で行う（APIは {ok:true} を返す）
      let data: any = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }
      setSaving(false);
      if (res.ok || data.ok) { // [FIX]
        if (reloadAccounts) reloadAccounts();
        onClose();
      } else {
        setError(data.error || "保存に失敗しました"); // [FIX]
      }
    } catch (e) {
      setError("通信エラー: " + String(e));
      setSaving(false);
    }
  };

  

  if (!open) { return null; }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
      <AccountCopyModal
        open={copyModalOpen}
        onClose={() => setCopyModalOpen(false)}
        onSelect={handleCopyAccountData}
      />
      <AIGeneratedPersonaModal
        open={aiPreviewModalOpen}
        onClose={() => setAiPreviewModalOpen(false)}
        personaDetail={aiPersonaDetail}
        personaSimple={aiPersonaSimple}
        onApply={handleApplyAIPersona}
      />
      <div className="relative min-w-[520px] max-h-[90vh] w-full max-w-[80vw]">
        <LoadingOverlay open={deletingLoading} message={deletingLoading ? '削除キューを作成しています。しばらくお待ちください。' : ''} />
        <button
          type="button"
          className="absolute top-2 right-2 text-gray-400 text-2xl p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 z-20"
          onClick={() => {
            try {
              if (deletionExecuted && reloadAccounts) reloadAccounts();
            } catch (e) {}
            onClose();
          }}
          aria-label="閉じる"
        >
          ×
        </button>
        <form
          className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-8 rounded shadow-lg min-w-[520px] max-h-[90vh] overflow-y-auto"
          onSubmit={handleSubmit}
        >
        <h2 className="text-xl font-bold mb-4">
          {mode === "edit" ? "アカウント編集" : "新規アカウント追加"}
        </h2>

        {error && <div className="mb-3 text-red-500">{error}</div>}

        {/* ここから上の既存項目は “全部そのまま” 残しています */}
        <label className="block">アカウント名</label>
        <input
          className="mb-2 border rounded px-2 py-1 w-full"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="例）営業用公式アカウント"
        />

        <label className="block">ID</label>
        <input
          className="mb-2 border rounded px-2 py-1 w-full"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          placeholder="@account_id"
        />

        {/* アクセストークンは UI から削除（内部で管理するため） */}

        {/* 認可ボタン（編集時のみ表示） */}
        {mode === "edit" && accountId && (
          <div className="mb-3 flex flex-col gap-2">
            <div className="flex gap-2">
              <button
                type="button"
                className="bg-yellow-500 text-white rounded px-3 py-1 hover:bg-yellow-600"
                onClick={async () => {
                  // 変更が検知されたら処理中止してメッセージを出す
                  if (areCredentialsModified()) {
                    alert('Threads App ID / Secret が編集されています。先に保存して続行してください');
                    return;
                  }

                  const apiUrl = '/api/auth/threads/start' + (accountId ? `?accountId=${encodeURIComponent(accountId)}` : '');
                  try {
                    const r = await fetch(apiUrl + '&raw=1', { headers: { Accept: 'application/json' } });
                    const j = await r.json().catch(() => ({}));
                    const authUrl = j.auth_url || apiUrl;
                    try {
                      await navigator.clipboard.writeText(authUrl);
                      alert('認可URLをクリップボードにコピーしました');
                      setAuthUrlFallback(null);
                    } catch (e) {
                      setAuthUrlFallback(authUrl);
                    }
                  } catch (e) {
                    // フェッチ失敗時は従来の挙動に戻す
                    const fallbackUrl = apiUrl;
                    try { await navigator.clipboard.writeText(fallbackUrl); alert('認可URLをクリップボードにコピーしました'); setAuthUrlFallback(null); }
                    catch { setAuthUrlFallback(fallbackUrl); }
                  }
                }}
              >
                認可URLをコピー
              </button>
            </div>
            {authUrlFallback && (
              <div className="text-sm">
                <div className="mb-1">クリップボードにコピーできませんでした。下のリンクをクリックして開くか、手動でコピーしてください。</div>
                <div className="flex gap-2 items-center">
                  <input className="flex-1 border rounded px-2 py-1" readOnly value={authUrlFallback} />
                  <a className="text-blue-600 underline" href={authUrlFallback} target="_blank" rel="noreferrer">開く</a>
                </div>
              </div>
            )}
          </div>
        )}

        <label className="block mt-2">Threads App ID (clientId)</label>
        <input
          className="mb-2 border rounded px-2 py-1 w-full"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="未設定の場合は空欄"
        />

        <label className="block">Threads App Secret (clientSecret)</label>
        {clientSecretMasked ? (
          <div className="mb-2 flex items-center gap-2">
            <input
              className="flex-1 border rounded px-2 py-1 w-full bg-gray-50"
              readOnly
              value={'********'}
            />
            <button
              type="button"
              className="px-3 py-1 border rounded bg-white hover:bg-gray-50"
              onClick={() => {
                // allow user to replace the masked secret
                setClientSecretMasked(false);
                setClientSecret("");
              }}
            >
              変更
            </button>
          </div>
        ) : (
          <input
            className="mb-2 border rounded px-2 py-1 w-full"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="登録済みのシークレットを上書きするにはここに入力"
          />
        )}

        <div className="text-sm text-gray-600 mb-3">
          <div>※ clientId / clientSecret を両方とも空にすると、ユーザー設定のデフォルトが使用されます。</div>
          <div>※ clientId と clientSecret のどちらか一方だけを入力した場合は保存できません。両方を入力してください。</div>
        </div>

        <div className="text-sm text-gray-600 mb-3">
          <div>※ clientId / clientSecret を両方とも空にすると、ユーザー設定のデフォルトが使用されます。</div>
          <div>※ clientId と clientSecret のどちらか一方だけを入力した場合は保存できません。両方を入力してください。</div>
        </div>

        <label className="block">キャラクターイメージ</label>
        <div className="flex gap-2 mb-2">
          <input
            className="border rounded px-2 py-1 flex-1 min-w-0"
            type="text"
            value={characterImage}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCharacterImage(e.target.value)}
            placeholder="キャラクターイメージ"
          />
          <button
            type="button"
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-400 whitespace-nowrap"
            onClick={handleAIGenerate}
            disabled={aiLoading || !authReady}
            title={!authReady ? '認証確認中のため操作できません' : undefined}
          >
            {aiLoading ? "生成中..." : !authReady ? "認証確認中..." : "AI生成"}
          </button>
        </div>

        {/* 既存アカウント複製ボタン：ラベルを明示、キャンセルは右上×のみで統一 */}
        <div className="my-3 flex gap-2">
          <button
            type="button"
            className="border px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100 border-gray-300 dark:border-gray-700"
            onClick={() => setCopyModalOpen(true)}
            aria-label="既存アカウント複製"
          >
            既存アカウント複製
          </button>
        </div>

        {/* ペルソナ入力（詳細モードをベースに、職業以下は大きめtextareaでタイトル付与） */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold">ペルソナ入力</span>
            <label className="flex items-center gap-1 cursor-pointer text-sm">
              <input
                type="checkbox"
                className="form-checkbox"
                checked={personaMode === "simple"}
                onChange={() => setPersonaMode(personaMode === "simple" ? "detail" : "simple")}
              />
              <span>簡易ペルソナ入力に切替</span>
            </label>
          </div>

          <div className="flex items-center gap-2 mb-2">
            <div className="flex-1" />
            <button
              type="button"
              className="text-sm px-2 py-1 border rounded bg-gray-50 hover:bg-gray-100"
              onClick={() => setBulkPersonaOpen((s) => !s)}
            >
              ペルソナ一括貼付
            </button>
          </div>

          {bulkPersonaOpen && (
            <div className="mb-3">
              <label className="block text-sm text-gray-600">貼付用テキスト</label>
              <textarea
                className="w-full border rounded p-2 mb-2 min-h-[120px]"
                value={bulkPersonaText}
                onChange={(e) => setBulkPersonaText(e.target.value)}
                placeholder={"例:\n名前\tゆうか\n年齢\t27\n..."}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="bg-blue-500 text-white px-3 py-1 rounded dark:bg-blue-600 dark:hover:bg-blue-700"
                  onClick={applyBulkPersona}
                >貼付して反映</button>
                <button
                  type="button"
                  className="px-3 py-1 border rounded dark:bg-gray-800 dark:text-gray-100"
                  onClick={() => { setBulkPersonaText(""); setBulkPersonaOpen(false); }}
                >キャンセル</button>
              </div>
            </div>
          )}

          {personaMode === "simple" ? (
            <textarea
              className="border rounded p-2 w-full mb-3 min-h-[80px] resize-y dark:bg-gray-800 dark:text-gray-100"
              placeholder="簡易ペルソナ（例：このアカウントは〇〇な性格で、〇〇が好きな女性...）"
              value={personaSimple}
              onChange={(e) => setPersonaSimple(e.target.value)}
            />
          ) : (
            <div className="grid grid-cols-2 gap-x-3 gap-y-4 mb-3">
              <div>
                <label className="text-sm text-gray-600">名前</label>
                <input className="border px-2 py-1 rounded w-full dark:bg-gray-800 dark:text-gray-100" name="name" value={persona.name} onChange={handlePersonaChange} placeholder="名前" />
              </div>
              <div>
                <label className="text-sm text-gray-600">年齢</label>
                <input className="border px-2 py-1 rounded w-full dark:bg-gray-800 dark:text-gray-100" name="age" value={persona.age} onChange={handlePersonaChange} placeholder="年齢" />
              </div>

              <div>
                <label className="text-sm text-gray-600">性別</label>
                <input className="border px-2 py-1 rounded w-full dark:bg-gray-800 dark:text-gray-100" name="gender" value={persona.gender} onChange={handlePersonaChange} placeholder="性別" />
              </div>
              <div className="col-span-2">
                <label className="text-sm text-gray-600">職業</label>
                <textarea className="border rounded p-2 w-full dark:bg-gray-800 dark:text-gray-100" name="job" value={persona.job} onChange={handlePersonaChange} />
              </div>

              {/* 職業以下は大きめtextarea群（タイトル付き） */}
              <div className="col-span-2 grid grid-cols-1 gap-3">
                <div>
                  <label className="text-sm text-gray-600">生活スタイル</label>
                  <textarea className="border rounded p-2 w-full dark:bg-gray-800 dark:text-gray-100" name="lifestyle" value={persona.lifestyle} onChange={handlePersonaChange} />
                </div>
                <div>
                  <label className="text-sm text-gray-600">投稿キャラ</label>
                  <textarea className="border rounded p-2 w-full dark:bg-gray-800 dark:text-gray-100" name="character" value={persona.character} onChange={handlePersonaChange} />
                </div>
                <div>
                  <label className="text-sm text-gray-600">口調・内面</label>
                  <textarea className="border rounded p-2 w-full dark:bg-gray-800 dark:text-gray-100" name="tone" value={persona.tone} onChange={handlePersonaChange} />
                </div>
                <div>
                  <label className="text-sm text-gray-600">語彙傾向</label>
                  <textarea className="border rounded p-2 w-full dark:bg-gray-800 dark:text-gray-100" name="vocab" value={persona.vocab} onChange={handlePersonaChange} />
                </div>
                <div>
                  <label className="text-sm text-gray-600">感情パターン</label>
                  <textarea className="border rounded p-2 w-full dark:bg-gray-800 dark:text-gray-100" name="emotion" value={persona.emotion} onChange={handlePersonaChange} />
                </div>
                <div>
                  <label className="text-sm text-gray-600">エロ表現</label>
                  <textarea className="border rounded p-2 w-full dark:bg-gray-800 dark:text-gray-100" name="erotic" value={persona.erotic} onChange={handlePersonaChange} />
                </div>
                <div>
                  <label className="text-sm text-gray-600">ターゲット層</label>
                  <textarea className="border rounded p-2 w-full dark:bg-gray-800 dark:text-gray-100" name="target" value={persona.target} onChange={handlePersonaChange} />
                </div>
                <div>
                  <label className="text-sm text-gray-600">投稿目的</label>
                  <textarea className="border rounded p-2 w-full dark:bg-gray-800 dark:text-gray-100" name="purpose" value={persona.purpose} onChange={handlePersonaChange} />
                </div>
                <div>
                  <label className="text-sm text-gray-600">絡みの距離感</label>
                  <textarea className="border rounded p-2 w-full dark:bg-gray-800 dark:text-gray-100" name="distance" value={persona.distance} onChange={handlePersonaChange} />
                </div>
                <div>
                  <label className="text-sm text-gray-600">NG要素</label>
                  <textarea className="border rounded p-2 w-full dark:bg-gray-800 dark:text-gray-100" name="ng" value={persona.ng} onChange={handlePersonaChange} />
                </div>
              </div>
            </div>
          )}
        </div>

        <label className="block">投稿グループ</label>
        <select
          className="mb-4 border px-2 py-1 rounded w-full"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
        >
          <option value="">選択してください</option>
          {groups.map((g: AutoPostGroupType) => (
            <option key={g.groupKey} value={g.groupKey}>
              {g.groupName}
            </option>
          ))}
        </select>

        {/* ▼追加UI: 2段階投稿（Threads用テキスト） */}
        <label className="block font-semibold mt-4">2段階投稿（Threads用テキスト）</label>
        <textarea
          className="border rounded p-2 w-full mb-4 min-h-[80px] resize-y"
          placeholder="例: 1回目投稿の◯分後にThreadsへ投稿する文章"
          value={secondStageContent}
          onChange={(e) => setSecondStageContent(e.target.value)}
        />

        {/* ▼追加UI: 監視対象アカウントID */}
        <label className="block font-semibold mt-2">監視対象アカウントID（引用元）</label>
        <input
          className="border rounded px-2 py-1 w-full mb-4"
          placeholder="例）target_account_id"
          value={monitoredAccountId}
          onChange={(e) => setMonitoredAccountId(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block font-semibold">引用作成開始時刻（JST）</label>
            <input type="time" className="mt-1 border rounded px-2 py-1 w-full" value={quoteTimeStart} onChange={(e) => setQuoteTimeStart(e.target.value)} />
          </div>
          <div>
            <label className="block font-semibold">引用作成終了時刻（JST）</label>
            <input type="time" className="mt-1 border rounded px-2 py-1 w-full" value={quoteTimeEnd} onChange={(e) => setQuoteTimeEnd(e.target.value)} />
          </div>
        </div>

          <div className="mt-6 flex items-center justify-between">
          <div>
            {mode === "edit" && (
              <button
                type="button"
                onClick={handleDelete}
                className="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700"
              >
                削除
              </button>
            )}
            {mode === "edit" && (
              <button
                type="button"
                onClick={handleDeleteAllPosts}
                className="ml-2 rounded bg-red-800 px-4 py-2 text-white hover:bg-red-900"
              >
                投稿全削除
              </button>
            )}
          </div>
          <div className="text-right">
            <button
              type="submit"
              className="bg-blue-500 text-white rounded px-5 py-2 hover:bg-blue-600 mr-2"
              // 既存の saving フラグがある場合は disabled を付与
            >
              {mode === "edit" ? "保存" : "登録"}
            </button>
            {/* Cancel removed - use top-right × to close */}
          </div>
        </div>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black opacity-40" onClick={() => setShowDeleteConfirm(false)} />
            <div className="relative bg-white dark:bg-gray-900 rounded shadow-lg p-6 w-full max-w-lg z-50">
              <div className="mb-2 font-semibold">投稿全削除の確認</div>
              <div className="text-sm mb-4">操作を選んでください。即時削除は最大100件を取得して削除します。即時削除は非常に時間がかかります。裏画面実行を使用することをおすすめします。</div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => { setShowDeleteConfirm(false); doImmediateDelete(); }} className="bg-red-700 text-white px-3 py-1 rounded hover:bg-red-800">即時削除(100件)</button>
                <button type="button" onClick={() => { setShowDeleteConfirm(false); doBackgroundDelete(); }} className="px-3 py-1 border rounded bg-white hover:bg-gray-50">裏画面実行(キュー化)</button>
                <button type="button" onClick={() => setShowDeleteConfirm(false)} className="px-3 py-1 border rounded">キャンセル</button>
              </div>
            </div>
          </div>
        )}
        {/* preview removed per user request */}
        {/* deletionMessage removed per user request */}
      </form>
    </div>
  </div>
  );
}
