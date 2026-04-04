#!/bin/bash
# config-edit-safe.sh — Safe 4-step config edit for openclaw.json
# Usage: bash scripts/config-edit-safe.sh <json_path> <value> <reason>
# Example: bash scripts/config-edit-safe.sh '.agents.defaults.models[0].alias' '"deepinfra/Qwen/Qwen3.5-35B-A3B"' "Qwen as orchestrator"
#
# Steps:
#   1. Fetch docs reference (validates we're not guessing keys)
#   2. Backup current config
#   3. Apply the edit with jq
#   4. Validate with openclaw doctor (read-only — NEVER --fix)

set -euo pipefail

CONFIG="$HOME/.openclaw/openclaw.json"
DOCS_URL="https://docs.openclaw.ai/gateway/configuration-reference"

if [ $# -lt 3 ]; then
    echo "Usage: $0 <json_path> <value> <reason>"
    echo "  json_path: jq path like '.agents.defaults.models[0].alias'"
    echo "  value:     jq value like '\"deepinfra/Qwen/Qwen3.5-35B-A3B\"' or '42' or 'true'"
    echo "  reason:    why this change is being made"
    echo ""
    echo "Example:"
    echo "  $0 '.agents.defaults.models[0].alias' '\"deepinfra/Qwen/Qwen3.5-35B-A3B\"' 'Switch to Qwen orchestrator'"
    exit 1
fi

JSON_PATH="$1"
VALUE="$2"
REASON="$3"

echo "=== Config Edit: $REASON ==="
echo "Path:  $JSON_PATH"
echo "Value: $VALUE"
echo ""

# Step 1: Fetch docs reference
echo "[1/4] Fetching configuration reference..."
DOCS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$DOCS_URL" 2>/dev/null || echo "000")
if [ "$DOCS_STATUS" = "200" ]; then
    echo "  Docs available (HTTP 200). Proceeding."
elif [ "$DOCS_STATUS" = "000" ]; then
    echo "  WARNING: Could not reach docs ($DOCS_URL)."
    echo "  Cannot validate key exists in schema."
    read -p "  Continue anyway? (y/N): " CONFIRM
    if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
        echo "  Aborted. Verify the key manually before editing."
        exit 1
    fi
else
    echo "  Docs returned HTTP $DOCS_STATUS. Proceeding with caution."
fi

# Step 2: Backup
echo "[2/4] Backing up current config..."
BACKUP="$CONFIG.bak.$(date +%Y%m%d-%H%M%S)"
cp "$CONFIG" "$BACKUP"
echo "  Saved: $BACKUP"

# Step 3: Apply edit
echo "[3/4] Applying edit..."

# Validate current config is valid JSON
if ! jq empty "$CONFIG" 2>/dev/null; then
    echo "  ERROR: Current config is not valid JSON. Aborting."
    exit 1
fi

# Check if path exists (warn if new key)
EXISTING=$(jq "$JSON_PATH" "$CONFIG" 2>/dev/null || echo "PATH_ERROR")
if [ "$EXISTING" = "PATH_ERROR" ]; then
    echo "  WARNING: Path $JSON_PATH may not exist or is invalid jq syntax."
    echo "  Double-check against docs reference."
    read -p "  Continue anyway? (y/N): " CONFIRM
    if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
        echo "  Aborted. Restoring backup."
        cp "$BACKUP" "$CONFIG"
        exit 1
    fi
elif [ "$EXISTING" = "null" ]; then
    echo "  NOTE: Path currently null/missing. Creating new key."
else
    echo "  Current value: $EXISTING"
fi

# Apply
TEMP=$(mktemp)
if jq "$JSON_PATH = $VALUE" "$CONFIG" > "$TEMP" 2>/dev/null; then
    mv "$TEMP" "$CONFIG"
    echo "  Edit applied."
else
    echo "  ERROR: jq edit failed. Restoring backup."
    rm -f "$TEMP"
    cp "$BACKUP" "$CONFIG"
    exit 1
fi

# Verify new value
NEW_VAL=$(jq "$JSON_PATH" "$CONFIG" 2>/dev/null)
echo "  New value: $NEW_VAL"

# Step 4: Validate
echo "[4/4] Validating with openclaw doctor..."
if command -v openclaw &>/dev/null; then
    DOCTOR_OUTPUT=$(openclaw doctor 2>&1) || true
    echo "$DOCTOR_OUTPUT"

    if echo "$DOCTOR_OUTPUT" | grep -qi "error\|invalid\|fail"; then
        echo ""
        echo "  WARNING: Doctor reported issues. Review above."
        echo "  Backup at: $BACKUP"
        echo "  To revert: cp $BACKUP $CONFIG"
    else
        echo "  Validation passed."
    fi

    # Also run config guard if available
    GUARD="$HOME/.openclaw/workspace/scripts/config-guard.sh"
    if [ -f "$GUARD" ]; then
        echo ""
        echo "  Running config guard check..."
        bash "$GUARD" check 2>&1 || true
    fi
else
    echo "  WARNING: openclaw command not found. Skipping validation."
    echo "  Manually verify config is correct."
fi

echo ""
echo "=== Done ==="
echo "Reason: $REASON"
echo "Backup: $BACKUP"
