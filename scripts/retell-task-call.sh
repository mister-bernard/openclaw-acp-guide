#!/bin/bash
# retell-task-call.sh — One-shot Retell AI phone call
# Usage: bash scripts/retell-task-call.sh <phone_number> <prompt_text> [from_number]
#
# Steps:
#   1. Create a Retell LLM with the task prompt
#   2. Create a temporary agent using that LLM
#   3. Make the call
#   4. Poll for completion and get transcript
#   5. Clean up temp agent + LLM
#
# Requires: RETELL_API_KEY in environment or ~/.openclaw/.env

set -euo pipefail

# Load env if not already set
if [ -z "${RETELL_API_KEY:-}" ]; then
    if [ -f "$HOME/.openclaw/.env" ]; then
        export $(grep -E '^RETELL_API_KEY=' "$HOME/.openclaw/.env" | head -1)
    fi
fi

if [ -z "${RETELL_API_KEY:-}" ]; then
    echo "ERROR: RETELL_API_KEY not set. Check ~/.openclaw/.env"
    exit 1
fi

if [ $# -lt 2 ]; then
    echo "Usage: $0 <phone_number> <prompt_text> [from_number]"
    echo ""
    echo "  phone_number: Target number with country code (e.g., +12125551234)"
    echo "  prompt_text:  What the AI should say/do on the call"
    echo "  from_number:  Optional caller ID (default: your Retell number)"
    echo ""
    echo "Example:"
    echo "  $0 '+12125551234' 'Call this restaurant and make a reservation for 2 at 7pm tonight under the name Smith.'"
    exit 1
fi

TO_NUMBER="$1"
PROMPT="$2"
FROM_NUMBER="${3:-${RETELL_FROM_NUMBER:-+1XXXXXXXXXX}}"

API="https://api.retellai.com"
AUTH="Authorization: Bearer $RETELL_API_KEY"
CT="Content-Type: application/json"

echo "=== Retell Task Call ==="
echo "To:   $TO_NUMBER"
echo "From: $FROM_NUMBER"
echo "Task: ${PROMPT:0:80}..."
echo ""

# Step 1: Create Retell LLM
echo "[1/5] Creating task LLM..."
LLM_RESPONSE=$(curl -s -X POST "$API/create-retell-llm" \
    -H "$AUTH" -H "$CT" \
    -d "$(jq -n --arg prompt "$PROMPT" '{
        model: "gpt-4o-mini",
        general_prompt: $prompt
    }')")

LLM_ID=$(echo "$LLM_RESPONSE" | jq -r '.llm_id // empty')
if [ -z "$LLM_ID" ]; then
    echo "ERROR: Failed to create LLM."
    echo "$LLM_RESPONSE" | jq . 2>/dev/null || echo "$LLM_RESPONSE"
    exit 1
fi
echo "  LLM ID: $LLM_ID"

# Step 2: Create temporary agent
echo "[2/5] Creating temporary agent..."
AGENT_RESPONSE=$(curl -s -X POST "$API/create-agent" \
    -H "$AUTH" -H "$CT" \
    -d "$(jq -n --arg llm_id "$LLM_ID" '{
        agent_name: "Task Call (auto)",
        voice_id: "11labs-Brian",
        response_engine: {
            type: "retell-llm",
            llm_id: $llm_id
        }
    }')")

AGENT_ID=$(echo "$AGENT_RESPONSE" | jq -r '.agent_id // empty')
if [ -z "$AGENT_ID" ]; then
    echo "ERROR: Failed to create agent."
    echo "$AGENT_RESPONSE" | jq . 2>/dev/null || echo "$AGENT_RESPONSE"
    # Cleanup LLM
    curl -s -X DELETE "$API/delete-retell-llm/$LLM_ID" -H "$AUTH" > /dev/null 2>&1
    exit 1
fi
echo "  Agent ID: $AGENT_ID"

# Step 3: Make the call
echo "[3/5] Initiating call..."
CALL_RESPONSE=$(curl -s -X POST "$API/v2/create-phone-call" \
    -H "$AUTH" -H "$CT" \
    -d "$(jq -n \
        --arg from "$FROM_NUMBER" \
        --arg to "$TO_NUMBER" \
        --arg agent "$AGENT_ID" \
        '{
            from_number: $from,
            to_number: $to,
            override_agent_id: $agent
        }')")

CALL_ID=$(echo "$CALL_RESPONSE" | jq -r '.call_id // empty')
if [ -z "$CALL_ID" ]; then
    echo "ERROR: Failed to initiate call."
    echo "$CALL_RESPONSE" | jq . 2>/dev/null || echo "$CALL_RESPONSE"
    # Cleanup
    curl -s -X DELETE "$API/delete-agent/$AGENT_ID" -H "$AUTH" > /dev/null 2>&1
    curl -s -X DELETE "$API/delete-retell-llm/$LLM_ID" -H "$AUTH" > /dev/null 2>&1
    exit 1
fi
echo "  Call ID: $CALL_ID"
echo "  Call initiated. Waiting for completion..."

# Step 4: Poll for completion (max 5 min)
echo "[4/5] Polling for transcript..."
MAX_POLLS=30
POLL_INTERVAL=10
COMPLETED=false

for i in $(seq 1 $MAX_POLLS); do
    sleep $POLL_INTERVAL

    STATUS_RESPONSE=$(curl -s "$API/v2/get-call/$CALL_ID" -H "$AUTH")
    CALL_STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.call_status // "unknown"')
    DISCONNECT=$(echo "$STATUS_RESPONSE" | jq -r '.disconnection_reason // "n/a"')

    if [ "$CALL_STATUS" = "ended" ] || [ "$CALL_STATUS" = "error" ]; then
        COMPLETED=true
        DURATION=$(echo "$STATUS_RESPONSE" | jq -r '.duration_ms // 0')
        DURATION_S=$((DURATION / 1000))

        echo ""
        echo "  Status:     $CALL_STATUS"
        echo "  Duration:   ${DURATION_S}s"
        echo "  Disconnect: $DISCONNECT"
        echo ""

        # Extract transcript
        TRANSCRIPT=$(echo "$STATUS_RESPONSE" | jq -r '
            .transcript_object // [] |
            map(
                (if .role == "agent" then "AGENT" else "THEM" end) + ": " + .content
            ) | join("\n")')

        if [ -n "$TRANSCRIPT" ] && [ "$TRANSCRIPT" != "" ]; then
            echo "=== TRANSCRIPT ==="
            echo "$TRANSCRIPT"
            echo "==================="
        else
            echo "  (No transcript available yet — may take 30-120s after call ends)"
        fi

        break
    fi

    echo "  [$i/$MAX_POLLS] Status: $CALL_STATUS (waiting ${POLL_INTERVAL}s...)"
done

if [ "$COMPLETED" = false ]; then
    echo "  WARNING: Call did not complete within polling window."
    echo "  Check manually: curl -s '$API/v2/get-call/$CALL_ID' -H 'Authorization: Bearer \$RETELL_API_KEY' | jq ."
fi

# Step 5: Cleanup
echo ""
echo "[5/5] Cleaning up temporary resources..."
curl -s -X DELETE "$API/delete-agent/$AGENT_ID" -H "$AUTH" > /dev/null 2>&1 && echo "  Deleted agent $AGENT_ID" || echo "  Warning: Could not delete agent"
curl -s -X DELETE "$API/delete-retell-llm/$LLM_ID" -H "$AUTH" > /dev/null 2>&1 && echo "  Deleted LLM $LLM_ID" || echo "  Warning: Could not delete LLM"

echo ""
echo "=== Done ==="
echo "Call ID: $CALL_ID"
echo "To check again: curl -s '$API/v2/get-call/$CALL_ID' -H 'Authorization: Bearer \$RETELL_API_KEY' | jq ."
