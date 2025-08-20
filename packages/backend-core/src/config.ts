// /packages/backend-core/src/config.ts
export const REGION = process.env.AWS_REGION || "ap-northeast-1";
export const TBL_SETTINGS = process.env.TBL_SETTINGS || "UserSettings";
export const TBL_THREADS = process.env.TBL_THREADS || "ThreadsAccounts";
