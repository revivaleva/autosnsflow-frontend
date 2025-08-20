// /next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
