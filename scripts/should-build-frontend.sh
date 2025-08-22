# /frontend/scripts/should-build-frontend.sh
#!/usr/bin/env bash
# [ADD] Amplify 早期終了ガード: フロントに関係ない差分なら /tmp/AMPLIFY_SKIP_BUILD を作る

set -euo pipefail

echo "[guard] detecting frontend changes..."

# Amplify/CodeBuild で安全のため
git config --global --add safe.directory "$(pwd)" || true

# 直前コミットを取得（初回やshallow cloneに備えてfetch）
BRANCH="${AWS_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
git fetch origin "$BRANCH" --depth=2 >/dev/null 2>&1 || true

if git rev-parse HEAD^ >/dev/null 2>&1; then
  BASE=HEAD^
else
  echo "[guard] first build on branch -> build is allowed"
  exit 0
fi

# 変更ファイル一覧
CHANGED="$(git diff --name-only "$BASE" HEAD || true)"
echo "[guard] changed files:"
echo "$CHANGED"

# フロントビルドに影響するパスの正規表現
# app/pages/components/lib/public/Next設定/依存関係など
PATTERN='^(src/|app/|pages/|components/|lib/|public/|next\.config\.(js|mjs)|package\.json|package-lock\.json|postcss\.config\.(js|mjs)|tailwind\.config\.(js|ts)|tsconfig\.json|middleware\.ts)'

if echo "$CHANGED" | grep -Eq "$PATTERN"; then
  echo "[guard] frontend change detected -> build continues"
else
  echo "[guard] no frontend-related change -> skip build"
  echo "skip" > /tmp/AMPLIFY_SKIP_BUILD
fi
