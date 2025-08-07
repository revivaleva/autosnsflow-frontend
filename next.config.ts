import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 本番ビルド時にESLintエラーを無視する
  eslint: {
    ignoreDuringBuilds: true,
  },
  /* config options here */
};

export default nextConfig;