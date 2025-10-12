#!/usr/bin/env bash
set -euo pipefail

# Script to update a ScheduledPost status to scheduled, invoke lambda every-5min,
# decode tail logs and fetch the item. Designed to run inside WSL bash.

TMPDIR=/tmp/aws-tmp
mkdir -p "$TMPDIR"

KEY_JSON=$TMPDIR/key.json
EAN_JSON=$TMPDIR/ean.json
EAV_JSON=$TMPDIR/eav.json
PAYLOAD_JSON=$TMPDIR/payload.json
LOG_B64=$TMPDIR/log_b64.txt
LOGS=$TMPDIR/lambda_logs.txt
OUT_JSON=$TMPDIR/lambda_out.json
UPDATE_RES=$TMPDIR/update_res.json
UPDATE_ERR=$TMPDIR/update_err.txt
GET_BEFORE=$TMPDIR/check_before.json
GET_AFTER=$TMPDIR/check_after.json
GET_ERR=$TMPDIR/get_err.txt

cat > "$KEY_JSON" <<'JSON'
{"PK":{"S":"USER#c7e43ae8-0031-70c5-a8ec-0f7962ee250f"},"SK":{"S":"SCHEDULEDPOST#1760053293060-12283"}}
JSON

cat > "$EAN_JSON" <<'JSON'
{"#st":"status"}
JSON

cat > "$EAV_JSON" <<'JSON'
{":s":{"S":"scheduled"}}
JSON

echo "=== GET ITEM BEFORE ==="
aws dynamodb get-item --table-name ScheduledPosts --key file://"$KEY_JSON" --output json > "$GET_BEFORE" 2> "$GET_ERR" || true
jq '.Item' "$GET_BEFORE" || echo "item-not-found-before"

echo "=== UPDATE ITEM: set status=scheduled ==="
aws dynamodb update-item \
  --table-name ScheduledPosts \
  --key file://"$KEY_JSON" \
  --update-expression 'SET #st = :s' \
  --expression-attribute-names file://"$EAN_JSON" \
  --expression-attribute-values file://"$EAV_JSON" \
  --return-values ALL_NEW > "$UPDATE_RES" 2> "$UPDATE_ERR" || true

echo "=== UPDATE STDOUT ==="
sed -n '1,200p' "$UPDATE_RES" || true
echo "=== UPDATE STDERR ==="
sed -n '1,200p' "$UPDATE_ERR" || true

echo "=== INVOKE LAMBDA every-5min ==="
printf '{"job":"every-5min"}' > "$PAYLOAD_JSON"
aws lambda invoke --cli-binary-format raw-in-base64-out --function-name scheduled-autosnsflow --payload fileb://"$PAYLOAD_JSON" "$OUT_JSON" --log-type Tail --query 'LogResult' --output text > "$LOG_B64" 2> "$TMPDIR/lambda_err.txt" || true

if [ -s "$LOG_B64" ]; then
  base64 --decode "$LOG_B64" > "$LOGS" || true
  echo "decoded logs -> $LOGS"
else
  echo "no tail logs (log_b64 empty)"
fi

echo "=== LAMBDA STDERR ==="
sed -n '1,200p' "$TMPDIR/lambda_err.txt" || true

echo "=== LAMBDA TAIL LOGS ==="
if [ -f "$LOGS" ]; then
  sed -n '1,400p' "$LOGS" || true
else
  echo "no-logs-file"
fi

echo "=== LAMBDA RESPONSE ==="
sed -n '1,200p' "$OUT_JSON" || true

echo "=== GET ITEM AFTER ==="
aws dynamodb get-item --table-name ScheduledPosts --key file://"$KEY_JSON" --output json > "$GET_AFTER" 2> "$GET_ERR" || true
echo "=== DDB GET STDERR ==="
sed -n '1,200p' "$GET_ERR" || true
echo "=== DDB ITEM AFTER ==="
jq '.Item' "$GET_AFTER" || echo 'item-not-found-after'

echo "=== DONE ==="


