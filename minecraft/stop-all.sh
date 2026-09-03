#!/usr/bin/env bash
# stop-all.sh — stop the bot, bridge, and minion controller by PID lookup.
#
# Graceful: sends SIGTERM, waits 5 s, sends SIGKILL on survivors.
# Does NOT touch the Minecraft server.

set -euo pipefail

stop_pid_on_port() {
  local port="$1"
  local label="$2"
  local pids
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "stopping $label (port $port, pid(s) $pids)"
    echo "$pids" | xargs -r kill -15 || true
    sleep 5
    pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      echo "  still alive, sending SIGKILL"
      echo "$pids" | xargs -r kill -9 || true
    fi
  else
    echo "$label: not running"
  fi
}

stop_pid_on_port 3001 "bot server"
stop_pid_on_port 3002 "LM Studio bridge"
stop_pid_on_port 3003 "minion controller"