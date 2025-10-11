// /packages/shared/src/index.ts
export * from "./types";
export * from "./time";
export * from "./ddbKeys";
export * from "./prompt";
export * from "./delete-posts-for-account";
export { default as deletePostsForAccountWithAdapters } from "./delete-posts-for-account";
// Backwards-compatible named export for frontend callers
export { deletePostsForAccountWithAdapters as deletePostsForAccount };
