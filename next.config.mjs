// next.config.mjs
// [IMPORTANT] AWS Amplifyでは next.config.ts はサポートされていません
// このファイルは next.config.mjs または next.config.js として保存する必要があります
// 参考: https://docs.aws.amazon.com/amplify/latest/userguide/troubleshooting-ssr-deployment.html

/** @type {import('next').NextConfig} */
const nextConfig = {
  // packages/shared や backend-core をフロントで使う場合のため
  transpilePackages: ["@autosnsflow/shared", "@autosnsflow/backend-core"],

  // [ADD] Amplify用のスタンドアロンビルド出力
  output: "standalone",

  // 本番ビルド時にESLintエラーを無視する
  eslint: {
    ignoreDuringBuilds: true,
  },

  // [ADD] 型エラーでビルドを止めないオプション（安全のためデフォルトOFF）
  //      Amplifyの環境変数に IGNORE_TS_ERRORS=1 を入れた時だけ無効化されます
  typescript: {
    ignoreBuildErrors: process.env.IGNORE_TS_ERRORS === "1",
  },

  // [ADD] 本番ビルドで console.* を削除（error は残す）→ バンドル小型化＆僅かなビルド短縮
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production" ? { exclude: ["error"] } : false,
  },

  // [ADD] Reactの厳格モード（開発体験向上・副作用検知）
  reactStrictMode: true,

  /* config options here */
};

export default nextConfig;
