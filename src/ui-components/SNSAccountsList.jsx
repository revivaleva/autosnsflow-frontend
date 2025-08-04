// ui-components/SNSAccountsList.jsx
import React, { useEffect, useState } from "react";
import { DataStore } from "@aws-amplify/datastore";
import { SNSAccount } from "../models";
import SNSAccountCard from "./SNSAccountCard";

const SNSAccountsList = () => {
  const [accounts, setAccounts] = useState([]);

  // 初回 + データ変更監視
  useEffect(() => {
    const fetchAccounts = async () => {
      //const all = await DataStore.query(SNSAccount);
        
        const all = [
        {
            id: "1",
            platform: "Twitter",
            displayName: "メインアカウント",
            accountId: "@main_account",
            createdAt: new Date().toISOString(),
            autoPost: true,
            autoGenerate: true,
            autoReply: false,
        },
        {
            id: "2",
            platform: "Threads",
            displayName: "副業アカウント",
            accountId: "@sub_account",
            createdAt: new Date().toISOString(),
            autoPost: false,
            autoGenerate: false,
            autoReply: true,
        }
        ];
      setAccounts(all);
    };

    fetchAccounts();

    const subscription = DataStore.observe(SNSAccount).subscribe(() => {
      fetchAccounts();
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <div style={{ maxWidth: "720px", margin: "auto", padding: "1rem" }}>
      <h2>SNSアカウント一覧</h2>
      {accounts.length === 0 ? (
        <p>アカウントが存在しません。</p>
      ) : (
        accounts.map((account) => (
          <SNSAccountCard key={account.id} account={account} />
        ))
      )}
    </div>
  );
};

export default SNSAccountsList;
