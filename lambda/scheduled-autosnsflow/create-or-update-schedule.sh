# /lambda/scheduled-autosnsflow/create-or-update-schedule.sh
# 【用途】EventBridge のスケジュールを新関数に向けます
# 使い方:
#   bash create-or-update-schedule.sh ap-northeast-1 scheduled-autosnsflow "rate(5 minutes)"

REGION="${1:-ap-northeast-1}"
FUNCTION_NAME="${2:-scheduled-autosnsflow}"
SCHEDULE="${3:-rate(5 minutes)}"
RULE_NAME="${FUNCTION_NAME}-rule"

set -euo pipefail

echo "[1/4] ルール作成（存在すれば上書き）"
aws events put-rule \
  --name "${RULE_NAME}" \
  --schedule-expression "${SCHEDULE}" \
  --region "${REGION}" \
  --state ENABLED >/dev/null

echo "[2/4] LambdaのARN取得"
LAMBDA_ARN=$(aws lambda get-function --function-name "${FUNCTION_NAME}" --region "${REGION}" --query 'Configuration.FunctionArn' --output text)

echo "[3/4] ルール → Lambda をターゲット設定"
aws events put-targets \
  --rule "${RULE_NAME}" \
  --region "${REGION}" \
  --targets "Id"="1","Arn"="${LAMBDA_ARN}"

echo "[4/4] Lambda に events からの実行権限を付与（冪等）"
aws lambda add-permission \
  --function-name "${FUNCTION_NAME}" \
  --statement-id "${RULE_NAME}-permission" \
  --action 'lambda:InvokeFunction' \
  --principal events.amazonaws.com \
  --source-arn "arn:aws:events:${REGION}:$(aws sts get-caller-identity --query Account --output text):rule/${RULE_NAME}" \
  --region "${REGION}" || true

echo "完了：${SCHEDULE} で ${FUNCTION_NAME} を起動します。"
