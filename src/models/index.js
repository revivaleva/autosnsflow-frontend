
// src/models/index.js
// @ts-check
// DataStore と initSchema は個別パッケージからインポート
// import { DataStore, initSchema } from "aws-amplify";
import { initSchema } from "aws-amplify/datastore";
import { schema } from "./schema";

const { LoginForm, SNSAccount } = initSchema(schema);

export {
  LoginForm,
  SNSAccount
};
