#!/usr/bin/env bash
# ClaimChain one-command demo launcher (for judges / presentations).
# Runs: Hardhat node -> contract deploy -> API server -> web dashboard.
# Open http://localhost:5173 when everything is ready. Ctrl+C stops everything.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BLOCKCHAIN="$ROOT/blockchain"
SERVER="$ROOT/server"
WEB="$ROOT/web"
ACCOUNT0_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" # local node account #0 = contract owner

PIDS=()

# Windows (Git Bash): clear leaked node children squatting on our ports
# (`kill` on npx wrappers does not reap children there).
kill_port() {
  local port="$1" pids pid
  pids=$(netstat -ano 2>/dev/null | grep ":$port" | grep -i LISTENING | awk '{print $NF}' | sort -u || true)
  for pid in $pids; do
    case "$pid" in *[!0-9]*) continue ;; esac
    taskkill //F //PID "$pid" >/dev/null 2>&1 || true
  done
}

cleanup() {
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  kill_port 4000
  kill_port 8545
  kill_port 5173
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

kill_port 8545
kill_port 4000
kill_port 5173

wait_for() { # url label
  for _ in $(seq 1 45); do
    if curl -s -m 2 -o /dev/null "$1"; then return 0; fi
    sleep 1
  done
  echo "FAIL: $2 did not become ready" >&2
  return 1
}

echo "== [1/4] Starting local blockchain node =="
(cd "$BLOCKCHAIN" && npx hardhat node > /tmp/cc-demo-node.log 2>&1) &
PIDS+=($!)
wait_for "http://127.0.0.1:8545" "Hardhat node"
echo "   node ready"

echo "== [2/4] Deploying ClaimAuditTrail =="
(cd "$BLOCKCHAIN" && npm run deploy:local > /tmp/cc-demo-deploy.log 2>&1)
# bash reads the file (MSYS path), node parses from stdin — require() cannot
# resolve /c/... MSYS-style paths on Windows.
ADDRESS="$(cat "$BLOCKCHAIN/deployments/localhost.json" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).address))")"
echo "   contract at $ADDRESS"

echo "== [3/4] Starting API server (port 4000) =="
(cd "$SERVER" && PORT=4000 RPC_URL=http://127.0.0.1:8545 PRIVATE_KEY="$ACCOUNT0_KEY" CONTRACT_ADDRESS="$ADDRESS" npx tsx src/index.ts > /tmp/cc-demo-api.log 2>&1) &
PIDS+=($!)
wait_for "http://localhost:4000/api/health" "API server"
echo "   api ready"

echo "== [4/4] Starting web dashboard (port 5173) =="
(cd "$WEB" && npx vite --port 5173 > /tmp/cc-demo-web.log 2>&1) &
PIDS+=($!)
wait_for "http://localhost:5173" "Web dashboard"

echo ""
echo "=============================================="
echo "  ClaimChain demo is LIVE"
echo "  Dashboard:  http://localhost:5173"
echo "  API:        http://localhost:4000/api/health"
echo ""
echo "  Demo flow for judges (all verdicts are COMPUTED by the real"
echo "  verification pipeline — EXIF, pHash, OCR, policy, fraud rules):"
echo "   1. Upload photos + bill -> evidence hashed, genesis sealed on-chain"
echo "   2. Pipeline runs automatically -> watch the stage logs decide"
echo "   3. Approved claim -> Pay via UPI (sealed)"
echo "   4. Flagged claim  -> pay is FROZEN (409) until human review approves"
echo "   5. Attempt Retro-Edit -> chain BREAKS (tamper proof!) -> Restore"
echo "=============================================="
echo ""
wait
