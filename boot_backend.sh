#!/usr/bin/env bash
# Boot only the backend stack (steps 1-3 of scripts/demo.sh) — leaves :5173 alone.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)/claimc-main"
BLOCKCHAIN="$ROOT/blockchain"
SERVER="$ROOT/server"
ACCOUNT0_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

wait_for() {
  for _ in $(seq 1 45); do
    if curl -s -m 2 -o /dev/null "$1"; then return 0; fi
    sleep 1
  done
  echo "FAIL: $2 not ready" >&2
  return 1
}

echo "== [1/3] hardhat node =="
(cd "$BLOCKCHAIN" && node node_modules/hardhat/dist/src/cli.js node > "$ROOT/../hardhat-node.log" 2>&1) &
NODE_PID=$!
wait_for "http://127.0.0.1:8545" "hardhat node" || exit 1
echo "node ready (pid $NODE_PID)"

echo "== [2/3] deploy contract =="
(cd "$BLOCKCHAIN" && node node_modules/hardhat/dist/src/cli.js run scripts/deploy.ts --network localhost > "$ROOT/../deploy.log" 2>&1) || exit 1
ADDRESS="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$BLOCKCHAIN/deployments/localhost.json','utf8')).address)")"
echo "contract at $ADDRESS"

echo "== [3/3] API server =="
(cd "$SERVER" && PORT=4000 RPC_URL=http://127.0.0.1:8545 PRIVATE_KEY="$ACCOUNT0_KEY" CONTRACT_ADDRESS="$ADDRESS" node node_modules/tsx/dist/cli.mjs src/index.ts > "$ROOT/../api.log" 2>&1) &
wait_for "http://localhost:4000/api/health" "API server" || exit 1
echo "api ready"
