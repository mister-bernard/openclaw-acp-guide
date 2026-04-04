#!/bin/bash
# heartbeat-all.sh — Consolidated heartbeat checks
# Usage: bash scripts/heartbeat-all.sh [--quiet]
#
# Runs all periodic health checks:
#   1. Service health (port checks)
#   2. Gateway status (recent restarts)
#   3. Task queue status
#   4. Pipeline continuation check
#   5. Disk usage
#   6. Stale backup cleanup
#
# Customize the SERVICES array below for your setup.

set -uo pipefail

WORKSPACE="$HOME/.openclaw/workspace"
QUIET="${1:-}"
ISSUES=0

divider() {
    [ "$QUIET" != "--quiet" ] && echo ""
    echo "=== $1 ==="
}

warn() {
    echo "WARNING: $1"
    ISSUES=$((ISSUES + 1))
}

# ------------------------------------------------------------------
# 1. Service Health (Port Checks)
# ------------------------------------------------------------------
divider "1. Service Health"

# Customize this for your services
declare -A SERVICES=(
    [18789]="OC-Gateway"
    # [3000]="Website"
    # [3001]="API-Service"
    # [8443]="Webhook-Handler"
)

ALL_UP=true
for port in "${!SERVICES[@]}"; do
    name="${SERVICES[$port]}"
    if nc -z 127.0.0.1 "$port" 2>/dev/null; then
        [ "$QUIET" != "--quiet" ] && echo "  OK: $name (port $port)"
    else
        warn "$name (port $port) is DOWN"
        ALL_UP=false
    fi
done

if $ALL_UP; then
    echo "  All services healthy"
fi

# ------------------------------------------------------------------
# 2. Gateway Status (Recent Restarts)
# ------------------------------------------------------------------
divider "2. Gateway Status"

RECENT_RESTART=$(journalctl --user -u openclaw-gateway --since "1 hour ago" 2>/dev/null | grep -c "Started\|Stopped\|restart" || echo "0")
if [ "$RECENT_RESTART" -gt 0 ]; then
    warn "Gateway restarted in the last hour ($RECENT_RESTART restart-related log entries)"
    journalctl --user -u openclaw-gateway --since "1 hour ago" 2>/dev/null | head -5
else
    echo "  No recent gateway restarts"
fi

# ------------------------------------------------------------------
# 3. Task Queue Status
# ------------------------------------------------------------------
divider "3. Task Queue"

TASKRUNNER="$WORKSPACE/tasks/taskrunner.py"
if [ -f "$TASKRUNNER" ]; then
    STATS=$(python3 "$TASKRUNNER" stats 2>&1) || STATS="ERROR: taskrunner failed"
    echo "$STATS"

    echo ""
    echo "  Next task:"
    python3 "$TASKRUNNER" next --dry-run 2>/dev/null || python3 "$TASKRUNNER" next 2>&1 | head -5 || echo "  (no tasks or error)"
else
    echo "  SKIP: taskrunner.py not found"
fi

# ------------------------------------------------------------------
# 4. Pipeline Continuation
# ------------------------------------------------------------------
divider "4. Pipeline Check"

PIPELINE_SCRIPT="$WORKSPACE/scripts/pipeline-check.sh"
if [ -f "$PIPELINE_SCRIPT" ]; then
    PIPELINE_OUTPUT=$(bash "$PIPELINE_SCRIPT" 2>&1) || true
    if [ -n "$PIPELINE_OUTPUT" ]; then
        echo "$PIPELINE_OUTPUT"
        if echo "$PIPELINE_OUTPUT" | grep -q "RETRY\|READY"; then
            warn "Pipeline needs attention (see above)"
        fi
    else
        echo "  No pipelines pending"
    fi
else
    echo "  SKIP: pipeline-check.sh not found"
fi

# ------------------------------------------------------------------
# 5. Disk Usage
# ------------------------------------------------------------------
divider "5. Disk Usage"

DISK_PCT=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
DISK_AVAIL=$(df -h / | awk 'NR==2 {print $4}')
echo "  Root: ${DISK_PCT}% used, ${DISK_AVAIL} available"

if [ "$DISK_PCT" -gt 85 ]; then
    warn "Disk usage above 85%"
fi

# ------------------------------------------------------------------
# 6. Stale Backup Cleanup
# ------------------------------------------------------------------
divider "6. Stale Backups"

STALE_COUNT=$(find "$HOME/.openclaw" -name "*.bak.*" -mtime +7 2>/dev/null | wc -l)
if [ "$STALE_COUNT" -gt 0 ]; then
    echo "  $STALE_COUNT backup files older than 7 days"
    echo "  Preview: find ~/.openclaw -name '*.bak.*' -mtime +7"
    echo "  Clean:   find ~/.openclaw -name '*.bak.*' -mtime +7 -delete"
else
    echo "  No stale backups"
fi

# ------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------
echo ""
echo "================================"
if [ "$ISSUES" -gt 0 ]; then
    echo "HEARTBEAT: $ISSUES issue(s) found"
else
    echo "HEARTBEAT: All clear"
fi
echo "================================"

exit $ISSUES
