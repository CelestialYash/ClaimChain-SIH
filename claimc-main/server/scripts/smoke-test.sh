#!/usr/bin/env bash
# ClaimChain end-to-end smoke test (workflow-spec edition):
# local Hardhat node -> deploy -> API boot -> REAL multipart intake + pipeline ->
# guard rejections (RULE ZERO) -> pay flow -> tamper demo -> restore.
# Everything runs inside this one shell so no background process needs to outlive it.
#
# Windows note: never share fixture files via /tmp — node resolves "/tmp/x" as
# "C:\tmp\x" while bash/curl use the MSYS /tmp. We use a repo-local dir that
# every tool resolves identically, and clean it on exit.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BLOCKCHAIN="$ROOT/blockchain"
SERVER="$ROOT/server"
ACCOUNT0_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" # node account #0 = contract owner
API="http://localhost:4000"
FIXTURES="$SERVER/.smoke-fixtures"

NODE_PID=""
API_PID=""

# Windows (Git Bash): `kill` on npx wrappers leaks node children, so previous
# runs can squat on our ports and serve STALE code. Clear them first.
# NOTE: grep exits 1 when nothing matches; with pipefail+set -e that would kill
# the script — hence the `|| true` guard inside the capture.
kill_port() {
  local port="$1" pids pid
  pids=$(netstat -ano 2>/dev/null | grep ":$port" | grep -i LISTENING | awk '{print $NF}' | sort -u || true)
  for pid in $pids; do
    case "$pid" in *[!0-9]*) continue ;; esac
    taskkill //F //PID "$pid" >/dev/null 2>&1 || true
  done
}

free_ports() {
  kill_port 8545
  kill_port 4000
  sleep 1
}

cleanup() {
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "$NODE_PID" ] && kill "$NODE_PID" 2>/dev/null || true
  # Also clear by port — catches the Windows child-process leak.
  kill_port 4000
  kill_port 8545
  rm -rf "$FIXTURES"
  wait 2>/dev/null || true
}
trap cleanup EXIT

free_ports
mkdir -p "$FIXTURES"
# Windows: node.exe and curl.exe are native binaries — hand them C:/... paths
# (cygpath -m = mixed form). On Linux cygpath is absent and FIXTURES is used as-is.
if command -v cygpath >/dev/null 2>&1; then FIXDIR="$(cygpath -m "$FIXTURES")"; else FIXDIR="$FIXTURES"; fi
if command -v cygpath >/dev/null 2>&1; then REPO="$(cygpath -m "$ROOT")"; else REPO="$ROOT"; fi

wait_for() { # url, label
  for _ in $(seq 1 60); do
    if curl -s -m 2 -o /dev/null "$1"; then return 0; fi
    sleep 1
  done
  echo "FAIL: $2 did not become ready" >&2
  return 1
}

jsonget() { # [json] key — json arg optional (stdin when omitted)
  local key json
  if [ $# -ge 2 ]; then json="$1"; key="$2"; else key="$1"; json="$(cat)"; fi
  CC_JSON="$json" CC_KEY="$key" node -e "let d=process.env.CC_JSON||'';try{const j=JSON.parse(d);const v=process.env.CC_KEY.split('.').reduce((a,k)=>a?.[k],j);console.log(typeof v==='object'?JSON.stringify(v):(v??''))}catch(e){console.log('PARSE_ERROR')}"
}

expect_eq() { # actual, expected, label
  if [ "$1" = "$2" ]; then echo "   PASS: $3"; else echo "   FAIL: $3 (expected '$2', got '$1')"; exit 1; fi
}

echo "== 1. Starting Hardhat node =="
(cd "$BLOCKCHAIN" && npx hardhat node > /tmp/cc-node.log 2>&1) &
NODE_PID=$!
wait_for "http://127.0.0.1:8545" "Hardhat node"
echo "node ready (pid $NODE_PID)"

echo "== 2. Deploying ClaimAuditTrail =="
(cd "$BLOCKCHAIN" && npm run deploy:local > /tmp/cc-deploy.log 2>&1)
# bash reads the file (MSYS path), node parses from stdin — require() cannot
# resolve /c/... MSYS-style paths on Windows.
ADDRESS="$(cat "$BLOCKCHAIN/deployments/localhost.json" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).address))")"
echo "deployed at $ADDRESS"

echo "== 3. Starting API server =="
(cd "$SERVER" && PORT=4000 RPC_URL=http://127.0.0.1:8545 PRIVATE_KEY="$ACCOUNT0_KEY" CONTRACT_ADDRESS="$ADDRESS" npx tsx src/index.ts > /tmp/cc-api.log 2>&1) &
API_PID=$!
wait_for "$API/api/health" "API server"
echo "api ready (pid $API_PID)"

# --- Insurer auth (INSURER_AUTH_DB_SECURITY_PLAN.md §2): the smoke test acts
# --- as the SUPERVISOR for every guarded call (review / pay / retry).
echo "== 4b. INSURER AUTH: login + guards + JWT =="
CODE="$(curl -s -o "$FIXTURES/login-bad.json" -w '%{http_code}' -X POST $API/api/auth/login -H 'Content-Type: application/json' -d '{"email":"supervisor@claimchain.gov.in","password":"wrong"}')"
expect_eq "$CODE" "401" "login wrong password → 401"
expect_eq "$(jsonget "$(cat "$FIXTURES/login-bad.json")" error)" "INVALID_CREDENTIALS" "error = INVALID_CREDENTIALS"
curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' -d '{"email":"supervisor@claimchain.gov.in","password":"supervisor"}' > "$FIXTURES/login.json"
TOKEN="$(jsonget "$(cat "$FIXTURES/login.json")" token)"
if [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; then echo "   PASS: supervisor login issued a JWT"; else echo "   FAIL: no token in login response"; exit 1; fi
AUTH=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
ME="$(curl -s $API/api/auth/me -H "Authorization: Bearer $TOKEN")"
expect_eq "$(echo "$ME" | jsonget user.role)" "supervisor" "/auth/me resolves the token → supervisor"
CODE="$(curl -s -o "$FIXTURES/noauth-pay.json" -w '%{http_code}' -X POST $API/api/claims/CLM-8919/pay -H 'Content-Type: application/json' -d '{"upiRef":"NO-AUTH-1"}')"
expect_eq "$CODE" "401" "pay WITHOUT token → 401 (auth gate precedes RULE ZERO)"
expect_eq "$(jsonget "$(cat "$FIXTURES/noauth-pay.json")" error)" "AUTH_REQUIRED" "error = AUTH_REQUIRED"
CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/api/claims/CLM-8919/transitions -H 'Content-Type: application/json' -d '{"status":"HUMAN_REVIEW","note":"no token"}')"
expect_eq "$CODE" "401" "human review WITHOUT token → 401"

echo "== 4. Health + seeded claims =="
HEALTH="$(curl -s $API/api/health)"
expect_eq "$(echo "$HEALTH" | jsonget chain.enabled)" "true" "chain enabled"
CLAIMS="$(curl -s $API/api/claims)"
N_SEEDS="$(echo "$CLAIMS" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).length))")"
echo "   seeded claims: $N_SEEDS (4102 archive, 8919 flagged, 8920 paid, 8930 fresh)"

echo "== 5. Verdicts are COMPUTED: seeded CLM-8919 must be AI_FLAGGED by the real pipeline =="
V8919="$(curl -s $API/api/claims/CLM-8919/verification)"
expect_eq "$(echo "$V8919" | jsonget verification.verdict)" "AI_FLAGGED" "8919 verdict = AI_FLAGGED"
STAGE="$(echo "$V8919" | jsonget verification.stages.1.details)"
echo "   DUPLICATE_PHASH → $STAGE"
expect_eq "$(echo "$V8919" | jsonget status)" "COMPLETE" "8919 verification complete"

echo "== 6. RULE ZERO: paying the FLAGGED seed claim must 409 =="
CODE="$(curl -s -o "$FIXTURES/pay1.json" -w '%{http_code}' -X POST $API/api/claims/CLM-8919/pay "${AUTH[@]}" -d '{"upiRef":"TEST-REF-1"}')"
expect_eq "$CODE" "409" "pay on flagged claim → 409"
expect_eq "$(jsonget "$(cat "$FIXTURES/pay1.json")" error)" "FLAGGED_LOCKED" "error = FLAGGED_LOCKED"

echo "== 7. Manual AI verdicts are REJECTED (pipeline-only) =="
CODE="$(curl -s -o "$FIXTURES/t1.json" -w '%{http_code}' -X POST $API/api/claims/CLM-8919/transitions "${AUTH[@]}" -d '{"status":"AI_APPROVED","note":"let me through"}')"
expect_eq "$CODE" "403" "manual AI_APPROVED → 403"
expect_eq "$(jsonget "$(cat "$FIXTURES/t1.json")" error)" "AI_VERDICTS_ARE_COMPUTED" "error = AI_VERDICTS_ARE_COMPUTED"

CODE="$(curl -s -o "$FIXTURES/t2.json" -w '%{http_code}' -X POST $API/api/claims/CLM-8919/transitions "${AUTH[@]}" -d '{"status":"PAID","note":"pay me"}')"
expect_eq "$CODE" "409" "transitions→PAID → 409 (USE_PAY_ENDPOINT)"

echo "== 8. REAL multipart intake: photos + bill upload, auto pipeline =="
IMG_A="$FIXDIR/photo-a.jpg"
IMG_B="$FIXDIR/photo-b.jpg"
BILL="$FIXDIR/bill.jpg"
# Run from the server dir so `require('sharp')` resolves from its node_modules.
(cd "$SERVER" && node -e "
const sharp=require('sharp');
const svg=(t)=>Buffer.from('<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"480\" height=\"360\"><rect width=\"480\" height=\"360\" fill=\"rgb(90,110,95)\"/><text x=\"50%\" y=\"50%\" font-family=\"DejaVu Sans, sans-serif\" font-size=\"20\" text-anchor=\"middle\" fill=\"#ffffff\">'+t+'</text></svg>');
(async()=>{
  await sharp(svg('flooded field damage')).jpeg().toFile(process.argv[1]);
  await sharp(svg('flooded field damage second angle')).jpeg().toFile(process.argv[2]);
  await sharp(svg('policy MH-12-9931 insured Ramesh Kumar claim amount 5000')).jpeg().toFile(process.argv[3]);
  console.log('evidence fixtures written');
})();
" "$IMG_A" "$IMG_B" "$BILL")

CREATE="$(curl -s -X POST $API/api/claims \
  -F 'claimantName=Ramesh Kumar' \
  -F 'lossType=flood' \
  -F 'amountRequested=5000' \
  -F "photos=@$IMG_A;type=image/jpeg" \
  -F "photos=@$IMG_B;type=image/jpeg" \
  -F "bills=@$BILL;type=image/jpeg")"
CLAIM_ID="$(echo "$CREATE" | jsonget claim.id)"
EVIDENCE_N="$(echo "$CREATE" | jsonget evidence.length)"
echo "   created $CLAIM_ID with $EVIDENCE_N evidence files"
expect_eq "$EVIDENCE_N" "3" "3 evidence rows stored"

echo "== 9. Auto-verification completes; verdict computed from evidence =="
sleep 12
VER="$(curl -s $API/api/claims/$CLAIM_ID/verification)"
STATUS="$(echo "$VER" | jsonget status)"
VERDICT="$(echo "$VER" | jsonget verification.verdict)"
SCORE="$(echo "$VER" | jsonget verification.score)"
echo "   pipeline: status=$STATUS verdict=$VERDICT score=$SCORE"
expect_eq "$STATUS" "COMPLETE" "verification completed"
N_STAGES="$(echo "$VER" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).verification.stages.length))")"
expect_eq "$N_STAGES" "8" "8 stage logs emitted (incl. DOC_CROSS)"
EXPL="$(echo "$VER" | jsonget verification.explanation)"
if [ "${#EXPL}" -ge 40 ]; then echo "   PASS: plain-language explanation present (${#EXPL} chars)"; else echo "   FAIL: explanation missing/too short (${#EXPL} chars)"; exit 1; fi
echo "   explanation: $(echo "$EXPL" | head -c 120)..."

echo "== 9c. RANDOM pics must NOT auto-approve (loss-type relevance guard) =="
RANDOM_IMG="$FIXDIR/random.jpg"
(cd "$SERVER" && node -e "
const sharp=require('sharp');
const svg='<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"480\" height=\"360\"><rect width=\"480\" height=\"360\" fill=\"rgb(210,180,140)\"/><circle cx=\"240\" cy=\"150\" r=\"60\" fill=\"rgb(240,200,170)\"/><text x=\"50%\" y=\"320\" font-family=\"DejaVu Sans, sans-serif\" font-size=\"18\" text-anchor=\"middle\" fill=\"#333\">birthday party selfie with friends indoors</text></svg>';
sharp(Buffer.from(svg)).jpeg().toFile(process.argv[1]).then(()=>console.log('random fixture written'));
" "$RANDOM_IMG")
R_CREATE="$(curl -s -X POST $API/api/claims \
  -F 'claimantName=Random Randy' \
  -F 'lossType=flood' \
  -F 'amountRequested=8000' \
  -F "photos=@$RANDOM_IMG;type=image/jpeg")"
R_ID="$(echo "$R_CREATE" | jsonget claim.id)"
echo "   created $R_ID (random imagery, flood claim)"
sleep 14
R_VERDICT="$(curl -s $API/api/claims/$R_ID/verification | jsonget verification.verdict)"
R_STAGE5="$(curl -s $API/api/claims/$R_ID/verification | jsonget verification.stages.5.details)"
echo "   verdict=$R_VERDICT"
echo "   stage5: $R_STAGE5"
if [ "$R_VERDICT" = "AI_FLAGGED" ] || [ "$R_VERDICT" = "AI_REJECTED" ]; then
  echo "   PASS: random pics did not auto-approve ($R_VERDICT)"
else
  echo "   FAIL: random pics got $R_VERDICT — relevance guard not working"
  exit 1
fi

R_PAY="$(curl -s -o "$FIXTURES/rpay.json" -w '%{http_code}' -X POST $API/api/claims/$R_ID/pay "${AUTH[@]}" -d '{"upiRef":"RANDOM-PAY-1"}')"
expect_eq "$R_PAY" "409" "random-evidence claim payout → 409 (RULE ZERO holds)"

echo "== 9d. FARMER DOCS: registry PDF + Aadhaar + satellite + destruction % =="
# Uses the USER-SUPPLIED real registry PDF (samples/registry.pdf) — validates
# bilingual OCR + PDF rasterization through the live API. Aadhaar/satellite
# are generated fixtures (Latin name card / aerial flood text).
AAD_IMG="$FIXDIR/aadhaar.jpg"
SAT_IMG="$FIXDIR/satellite.jpg"
(cd "$SERVER" && node -e "
const sharp=require('sharp');
const aad='<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"640\" height=\"400\"><rect width=\"640\" height=\"400\" fill=\"#ffffff\"/><text x=\"320\" y=\"60\" font-family=\"DejaVu Sans, sans-serif\" font-size=\"24\" text-anchor=\"middle\" fill=\"#333\">GOVERNMENT OF INDIA</text><text x=\"320\" y=\"140\" font-family=\"DejaVu Sans, sans-serif\" font-size=\"30\" text-anchor=\"middle\" fill=\"#000\">Name: Roshan Pandey</text><text x=\"320\" y=\"190\" font-family=\"DejaVu Sans, sans-serif\" font-size=\"22\" text-anchor=\"middle\" fill=\"#333\">DoB: 03/01/1995</text><text x=\"320\" y=\"240\" font-family=\"DejaVu Sans, sans-serif\" font-size=\"22\" text-anchor=\"middle\" fill=\"#333\">MALE</text><text x=\"320\" y=\"330\" font-family=\"DejaVu Sans, sans-serif\" font-size=\"34\" text-anchor=\"middle\" fill=\"#000\">5522 6616 4533</text></svg>';
const sat='<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"640\" height=\"400\"><rect width=\"640\" height=\"400\" fill=\"rgb(70,90,120)\"/><text x=\"50%\" y=\"50%\" font-family=\"DejaVu Sans, sans-serif\" font-size=\"22\" text-anchor=\"middle\" fill=\"#cfe\">aerial view of flooded village under muddy water</text></svg>';
(async()=>{
  await sharp(Buffer.from(aad)).jpeg().toFile(process.argv[1]);
  await sharp(Buffer.from(sat)).jpeg().toFile(process.argv[2]);
  console.log('doc fixtures written');
})();
" "$AAD_IMG" "$SAT_IMG")

F_CREATE="$(curl -s -X POST $API/api/claims \
  -F 'claimantName=Roshan Pandey' \
  -F 'lossType=flood' \
  -F 'amountRequested=12000' \
  -F 'destructionPctClaimed=90' \
  -F "photos=@$IMG_A;type=image/jpeg" \
  -F "registry=@$REPO/samples/registry.pdf;type=application/pdf" \
  -F "aadhaar=@$AAD_IMG;type=image/jpeg" \
  -F "satellite=@$SAT_IMG;type=image/jpeg")"
F_ID="$(echo "$F_CREATE" | jsonget claim.id)"
echo "   created $F_ID with registry PDF + aadhaar + satellite"
# Bilingual OCR over a real 6-page CamScanner deed can take well over a minute
# — poll the verification job for completion instead of a fixed sleep.
F_STATUS="RUNNING"
for i in $(seq 1 36); do
  sleep 5
  F_STATUS="$(curl -s $API/api/claims/$F_ID/verification | jsonget status)"
  case "$F_STATUS" in
    RUNNING|""|null) continue ;;
    *) break ;;
  esac
done
F_VER="$(curl -s $API/api/claims/$F_ID/verification)"
echo "   pipeline: status=$F_STATUS (after ~$((i * 5))s)"
expect_eq "$F_STATUS" "COMPLETE" "farmer-doc verification completed"
F_REG="$(echo "$F_VER" | jsonget verification.docSummary.registry.found)"
F_AAD="$(echo "$F_VER" | jsonget verification.docSummary.aadhaar.found)"
F_SAT="$(echo "$F_VER" | jsonget verification.docSummary.satellite.found)"
F_PCT="$(echo "$F_VER" | jsonget verification.docSummary.satellite.destructionPct)"
expect_eq "$F_REG" "true" "registry PDF parsed (bilingual OCR + raster)"
expect_eq "$F_AAD" "true" "Aadhaar parsed (name extracted)"
expect_eq "$F_SAT" "true" "satellite imagery scored"
if [ "$F_PCT" != "null" ] && [ "$F_PCT" != "" ] && [ "$F_PCT" -ge 0 ] 2>/dev/null && [ "$F_PCT" -le 100 ] 2>/dev/null; then
  echo "   PASS: destruction % measured ($F_PCT%) vs claimed 90%"
else
  echo "   FAIL: satellite destructionPct invalid ($F_PCT)"; exit 1
fi
F_CROSS="$(echo "$F_VER" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.verification.docSummary.identityCross.detail)})")"
echo "   identity cross: $F_CROSS"
F_HAS_STAGE="$(echo "$F_VER" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.verification.stages.some(s=>s.stage==='DOC_CROSS'))})")"
expect_eq "$F_HAS_STAGE" "true" "DOC_CROSS stage present in logs"
# The real CamScanner deed is unreadable to OCR → the cross-check must come out
# INCONCLUSIVE (WARN), never a hard R-IDENTITY fraud conviction on an honest farmer.
F_XINCON="$(echo "$F_VER" | jsonget verification.docSummary.identityCross.inconclusive)"
F_DC="$(echo "$F_VER" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const s=j.verification.stages.find(s=>s.stage==='DOC_CROSS');console.log(s?s.result:'MISSING')})")"
if [ "$F_XINCON" = "true" ]; then
  expect_eq "$F_DC" "WARN" "unreadable deed → identity cross INCONCLUSIVE (WARN, not fraud)"
else
  echo "   (registry parsed a name — inconclusive path not exercised this run; DOC_CROSS=$F_DC)"
fi

echo "== 10. Decision record sealed on-chain with verification digest =="
TRAIL="$(curl -s $API/api/claims/$CLAIM_ID/audit-trail)"
expect_eq "$(echo "$TRAIL" | jsonget integrity.onChainValid)" "true" "on-chain trail valid"
N_RECORDS="$(echo "$TRAIL" | jsonget recordCount)"
echo "   sealed records: $N_RECORDS (genesis + AI decision)"

echo "== 11. Pay only when unlocked =="
if [ "$VERDICT" = "AI_APPROVED" ]; then
  CODE="$(curl -s -o "$FIXTURES/pay2.json" -w '%{http_code}' -X POST $API/api/claims/$CLAIM_ID/pay "${AUTH[@]}" -d '{"upiRef":"UPI-TEST-90210"}')"
  expect_eq "$CODE" "200" "pay on approved claim → 200"
  expect_eq "$(jsonget "$(cat "$FIXTURES/pay2.json")" claim.status)" "PAID" "claim now PAID"
  # terminal: second pay rejected
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/api/claims/$CLAIM_ID/pay "${AUTH[@]}" -d '{"upiRef":"UPI-TEST-90211"}')"
  expect_eq "$CODE" "409" "double-pay → 409"
else
  echo "   (pipeline flagged the fresh claim — testing human-review lane instead)"
  CODE="$(curl -s -o "$FIXTURES/pay3.json" -w '%{http_code}' -X POST $API/api/claims/$CLAIM_ID/pay "${AUTH[@]}" -d '{"upiRef":"UPI-TEST-90210"}')"
  expect_eq "$CODE" "409" "pay on flagged fresh claim → 409"
  CODE="$(curl -s -o "$FIXTURES/ha.json" -w '%{http_code}' -X POST $API/api/claims/$CLAIM_ID/transitions "${AUTH[@]}" -d '{"status":"HUMAN_APPROVED","note":"Human review: field visit confirmed genuine flood damage on-site.","reviewer":"supervisor"}')"
  expect_eq "$CODE" "200" "human approve with reason → 200"
  expect_eq "$(jsonget "$(cat "$FIXTURES/ha.json")" claim.status)" "HUMAN_APPROVED" "status = HUMAN_APPROVED"
  CODE="$(curl -s -o "$FIXTURES/pay4.json" -w '%{http_code}' -X POST $API/api/claims/$CLAIM_ID/pay "${AUTH[@]}" -d '{"upiRef":"UPI-TEST-90210"}')"
  expect_eq "$CODE" "200" "pay after human approval → 200"
fi

echo "== 12. Human review requires a real reason (>= 20 chars) =="
CODE="$(curl -s -o "$FIXTURES/hs.json" -w '%{http_code}' -X POST $API/api/claims/CLM-8919/transitions "${AUTH[@]}" -d '{"status":"HUMAN_APPROVED","note":"ok fine pay it"}')"
expect_eq "$CODE" "400" "short reason → 400"
expect_eq "$(jsonget "$(cat "$FIXTURES/hs.json")" error)" "REASON_TOO_SHORT" "error = REASON_TOO_SHORT"

echo "== 13. Late evidence = sealed ADDENDUM =="
CODE="$(curl -s -o "$FIXTURES/add.json" -w '%{http_code}' -X POST $API/api/claims/CLM-8930/evidence -F "photos=@$IMG_A;type=image/jpeg")"
expect_eq "$CODE" "201" "addendum upload → 201"
expect_eq "$(jsonget "$(cat "$FIXTURES/add.json")" sealed)" "true" "addendum sealed on-chain"

echo "== 14. Evidence integrity + serving =="
FILE_ID="$(echo "$CREATE" | jsonget evidence.0.fileId)"
CODE="$(curl -s -o "$FIXTURES/ev-served.jpg" -w '%{http_code}' $API/api/evidence/$FILE_ID)"
expect_eq "$CODE" "200" "evidence bytes served"
# wc -c resolves the repo-local fixture dir identically for bash and curl.
UPLOADED_BYTES="$(wc -c < "$IMG_A")"
SERVED_BYTES="$(wc -c < "$FIXTURES/ev-served.jpg")"
expect_eq "$SERVED_BYTES" "$UPLOADED_BYTES" "served bytes identical to upload ($SERVED_BYTES bytes)"

echo "== 15. Stats KPIs (flaggedLocked, verificationDurationP50Ms) =="
STATS="$(curl -s $API/api/stats)"
echo "   $(echo "$STATS" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('flaggedLocked:',j.flaggedLocked,'| p50 ms:',j.verificationDurationP50Ms,'| leakage ₹:',j.leakagePreventedInr,'| records:',j.totalRecords)})")"
expect_eq "$(echo "$STATS" | jsonget chainEnabled)" "true" "stats chain enabled"

echo "== 15b. TRAINED fraud memory (CLIP k-NN over decided claims) =="
MEM="$(curl -s $API/api/fraud-memory)"
MEM_SIZE="$(echo "$MEM" | jsonget size)"
echo "   $(echo "$MEM" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('trained embeddings:',j.size,'(genuine:'+j.genuine+', fraud:'+j.fraud+') engine:'+j.engine)})")"
if [ "$MEM_SIZE" -ge 4 ] 2>/dev/null; then echo "   PASS: fraud memory trained ($MEM_SIZE embeddings)"; else echo "   FAIL: fraud memory not trained ($MEM_SIZE)"; exit 1; fi
# The fresh claim's DAMAGE_ASSESS log must show the trained-memory kNN line.
DA="$(curl -s $API/api/claims/$CLAIM_ID/verification | jsonget verification.stages.5.details)"
echo "   DAMAGE_ASSESS → $DA"
case "$DA" in *"trained memory: kNN"*) echo "   PASS: stage 5 used the trained memory" ;; *) echo "   FAIL: stage 5 did not use the trained memory"; exit 1 ;; esac
case "$DA" in *"zero-shot staged-imagery"*) echo "   PASS: stage 5 ran the CLIP zero-shot staged-imagery check" ;; *) echo "   FAIL: stage 5 missing zero-shot check"; exit 1 ;; esac

echo "== 16. TAMPER DEMO: retro-edit record 1 of $CLAIM_ID =="
curl -s -X POST $API/api/demo/tamper \
  -H 'Content-Type: application/json' \
  -d "{\"claimId\":\"$CLAIM_ID\",\"recordIndex\":1,\"forgedLabel\":\"e2-FORGED-15000\"}" > "$FIXTURES/tamper.json"
expect_eq "$(jsonget "$(cat "$FIXTURES/tamper.json")" integrity.onChainValid)" "false" "on-chain integrity broken"
echo "   verdict: $(jsonget "$(cat "$FIXTURES/tamper.json")" verdict)"

echo "== 17. RESTORE =="
curl -s -X POST $API/api/demo/restore \
  -H 'Content-Type: application/json' \
  -d "{\"claimId\":\"$CLAIM_ID\",\"recordIndex\":1}" > "$FIXTURES/restore.json"
expect_eq "$(jsonget "$(cat "$FIXTURES/restore.json")" integrity.onChainValid)" "true" "chain restored"
echo "   verdict: $(jsonget "$(cat "$FIXTURES/restore.json")" verdict)"

echo "== 17b. RELATIONAL HISTORY: SQLite mirror, status groups, assignment =="
HIST="$(curl -s "$API/api/history?status=flagged")"
H_COUNT="$(echo "$HIST" | jsonget count)"
if [ "$H_COUNT" -ge 1 ] 2>/dev/null; then echo "   PASS: history?status=flagged → $H_COUNT row(s)"; else echo "   FAIL: flagged history empty"; exit 1; fi
H_SEARCH="$(curl -s "$API/api/history?search=CLM-8920")"
expect_eq "$(echo "$H_SEARCH" | jsonget count)" "1" "history?search=CLM-8920 → 1 row"
# Assign the fresh claim to inspector 1, then filter by that inspector.
CODE="$(curl -s -o "$FIXTURES/assign.json" -w '%{http_code}' -X POST $API/api/claims/CLM-8930/assign "${AUTH[@]}" -d '{"inspectorId":"usr-inspector-1"}')"
expect_eq "$CODE" "200" "assign CLM-8930 → inspector 1 (200)"
H_INS="$(curl -s "$API/api/history?inspector=usr-inspector-1")"
H_INS_COUNT="$(echo "$H_INS" | jsonget count)"
if [ "$H_INS_COUNT" -ge 1 ] 2>/dev/null; then echo "   PASS: history?inspector=usr-inspector-1 → $H_INS_COUNT row(s)"; else echo "   FAIL: inspector filter empty after assignment"; exit 1; fi
INSPECTORS="$(curl -s $API/api/users "${AUTH[@]}")"
N_USERS="$(echo "$INSPECTORS" | jsonget users.0.email >/dev/null 2>&1; echo $?)"
echo "   roster reachable (rc=$N_USERS)"

# Restart-survival for the SQLite layer: users persist (INSERT OR IGNORE),
# and the mirror re-syncs from the snapshot on the next boot.
echo "   SQLite mirror: $(ls -la "$SERVER/.data/claimchain.db" 2>/dev/null | awk '{print $5" bytes"}' || echo 'missing')"

echo "== 18. Smoke test complete — ALL PASS ✅ =="
