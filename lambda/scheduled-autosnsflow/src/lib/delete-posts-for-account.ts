// shim: delegate to project-level implementation at runtime to avoid compile-time cross-root imports
export async function deletePostsForAccount(args: any) {
  // dynamic import using runtime path to avoid TypeScript resolution into lambda rootDir
  const mod = await import(process.cwd() + '/src/lib/delete-posts-for-account');
  return await mod.deletePostsForAccount(args);
}

export default deletePostsForAccount;


