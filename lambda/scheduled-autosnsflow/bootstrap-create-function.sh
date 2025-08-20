# /lambda/scheduled-autosnsflow/bootstrap-create-function.sh
# 【用途】初回のみ。関数が存在しない場合に作成します。
# 使い方:
#   bash bootstrap-create-function.sh <REGION> <ROLE_ARN>
# 例:
#   bash bootstrap-create-function.sh ap-northeast-1 arn:aws:iam::<ACCOUNT_ID>:role/<LambdaRole>

set -euo pipefail
REGION="${1:-ap-northeast-1}"
ROLE_ARN="${2:-}"

if [ -z "$ROLE_ARN" ]; then
  echo "ROLE_ARN を指定してください"; exit 1
fi

NAME="scheduled-autosnsflow"

# dist/ を用意
node -v >/dev/null 2>&1 || { echo "Node 未インストール"; exit 1; }
npm ci
npm -w @autosnsflow/shared run build
npm -w @autosnsflow/backend-core run build
cd lambda/scheduled-autosnsflow
npm ci
npm run build
npm run zip
cd -

EXISTS=$(aws lambda get-function --function-name "$NAME" --region "$REGION" --query 'Configuration.FunctionName' --output text 2>/dev/null || true)

if [ "$EXISTS" = "$NAME" ]; then
  echo "既に存在します: $NAME"
  exit 0
fi

ZIP="lambda/scheduled-autosnsflow/bundle.zip"

echo "関数を作成します: $NAME"
aws lambda create-function \
  --function-name "$NAME" \
  --runtime nodejs20.x \
  --handler handler.handler \
  --architectures arm64 \
  --zip-file fileb://"$ZIP" \
  --role "$ROLE_ARN" \
  --timeout 60 \
  --memory-size 256 \
  --region "$REGION"

echo "環境変数を設定します（必要に応じて編集してください）"
aws lambda update-function-configuration \
  --function-name "$NAME" \
  --environment "Variables={AWS_REGION=$REGION,TBL_SETTINGS=UserSettings,TBL_THREADS=ThreadsAccounts,DEFAULT_USER_ID=c7e43ae8-0031-70c5-a8ec-0f7962ee250f,MASTER_DISCORD_WEBHOOK=}" \
  --region "$REGION"

echo "作成完了: $NAME"
