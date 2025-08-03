
// src/models/index.js
// @ts-check
// DataStore と initSchema は個別パッケージからインポート
import { DataStore, initSchema } from "@aws-amplify/datastore"; // ← 個別パッケージから取得
import { schema } from "./schema";

const { LoginForm } = initSchema(schema);

export {
  LoginForm
};
