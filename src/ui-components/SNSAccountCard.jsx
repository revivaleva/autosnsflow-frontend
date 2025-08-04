// ui-components/SNSAccountCard.jsx
import React, { useState } from "react";
import { DataStore } from "@aws-amplify/datastore";
import { SNSAccount } from "../models";

const SNSAccountCard = ({ account }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localState, setLocalState] = useState({ ...account });

  const toggleEdit = () => setIsEditing(!isEditing);

  const handleChange = (field) => {
    setLocalState((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  const handleSave = async () => {
    try {
      await DataStore.save(
        SNSAccount.copyOf(account, (updated) => {
          updated.autoPost = localState.autoPost;
          updated.autoGenerate = localState.autoGenerate;
          updated.autoReply = localState.autoReply;
        })
      );
      setIsEditing(false);
    } catch (error) {
      console.error("保存に失敗しました", error);
    }
  };

  if (!account) return null;

  return (
    <div
      style={{
        border: "1px solid #ccc",
        padding: "16px",
        borderRadius: "8px",
        marginBottom: "12px",
        backgroundColor: "#f9f9f9",
      }}
    >
      <h3>
        {account.displayName}（{account.platform}）
      </h3>
      <p>
        <strong>アカウントID:</strong> {account.accountId}
      </p>
      <p>
        <strong>作成日:</strong>{" "}
        {new Date(account.createdAt).toLocaleString()}
      </p>

      <p>
        <strong>自動投稿:</strong>{" "}
        {isEditing ? (
          <input
            type="checkbox"
            checked={localState.autoPost}
            onChange={() => handleChange("autoPost")}
          />
        ) : account.autoPost ? (
          "オン"
        ) : (
          "オフ"
        )}
        {" / "}
        <strong>本文生成:</strong>{" "}
        {isEditing ? (
          <input
            type="checkbox"
            checked={localState.autoGenerate}
            onChange={() => handleChange("autoGenerate")}
          />
        ) : account.autoGenerate ? (
          "オン"
        ) : (
          "オフ"
        )}
        {" / "}
        <strong>リプ返信:</strong>{" "}
        {isEditing ? (
          <input
            type="checkbox"
            checked={localState.autoReply}
            onChange={() => handleChange("autoReply")}
          />
        ) : account.autoReply ? (
          "オン"
        ) : (
          "オフ"
        )}
      </p>

      <div style={{ marginTop: "8px" }}>
        {isEditing ? (
          <>
            <button onClick={handleSave}>保存</button>{" "}
            <button onClick={toggleEdit}>キャンセル</button>
          </>
        ) : (
          <button onClick={toggleEdit}>編集</button>
        )}
      </div>
    </div>
  );
};

export default SNSAccountCard;
