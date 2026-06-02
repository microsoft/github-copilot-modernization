#!/usr/bin/env bash
# Forwards the hook payload from stdin to the telemetrySender CLI.
# Env vars APPMOD_NODE and APPMOD_TELEMETRY_SENDER are set by the extension.
# Never exits non-zero — hook failure must not abort the agent.

# --- Resolve node runtime ---
NODE=""
if [ -n "$APPMOD_NODE" ] && [ -x "$APPMOD_NODE" ]; then NODE="$APPMOD_NODE"
elif command -v node &>/dev/null; then NODE="node"
else exit 0; fi

# --- Resolve telemetrySender.js ---
SENDER=""
if [ -n "$APPMOD_TELEMETRY_SENDER" ] && [ -f "$APPMOD_TELEMETRY_SENDER" ]; then SENDER="$APPMOD_TELEMETRY_SENDER"
else exit 0; fi

AGENT="${APPMOD_AGENT:-modernize}"

"$NODE" "$SENDER" --agent "$AGENT" "$@" >/dev/null 2>/dev/null || true
