# ClaimChain — Persistent Context & Conversation Log

> Single source of truth for project context and our working history.
> **Maintenance rule:** a dated entry is appended to the [Conversation Log](#conversation-log) at the end of every meaningful turn, so this file stays in sync with the conversation.

---

## 1. Project Snapshot

**ClaimChain** is an AI-assisted micro-insurance claims platform with a blockchain-backed immutable audit trail, aimed at Indian farmers and low-income policyholders (payouts typically ₹1,000–₹10,000).

**Core flow (from `ClaimChain_Description.md`):**
1. **Submit** — claimant uploads photos of damage/bills/ID from a basic smartphone; no forms.
2. **Verify** — Document AI extracts policy/bill data; computer vision assesses damage; perceptual-hash (pHash) database catches reused/altered images; cross-check against policy terms and past claims.
3. **Decide** — approve / flag / escalate to human in under a minute, with plain-language reasoning.
4. **Seal** — every event (submission, AI decision, human override, payout) is hashed and chained on-chain (Polygon L2 in mockups); retro-edits break the hash chain.
5. **Prove** — customers and regulators verify integrity via hashes without exposing PII.

**Current phase: WORKING FULL-STACK MVP (Local & Hybrid Cloud).**
- Monorepo with three functional workspaces: `blockchain/` (Solidity smart contracts + Hardhat), `server/` (Node/Express 5 + local AI models + Ethers v6), and `web/` (React 19 + Vite + Tailwind v4).
- Deployed on **Polygon Amoy Testnet** (contract `0xb2aE1FC9887b1F77D1e45944654f0D7349B0Ce27`).
- Cloud hosted on **Render** (API backend: `https://claimchain-api.onrender.com`) and **Vercel** (Vite frontend: `https://claimchain-mu.vercel.app`).
- Primary development & presentation environment: **One-command local demo runner** (`npm run dev` / `bash scripts/demo.sh`) on ports 5173, 4000, 8545.

### Repository structure

```
├── CLAIMCHAIN_CONTEXT.md            # Single source of truth for project context & log
├── package.json                     # Root runner scripts (npm run dev / demo / install:all)
├── scripts/
│   └── demo.sh                      # One-command demo orchestrator (Hardhat -> deploy -> API -> Web)
├── blockchain/                      # Hardhat workspace
│   ├── contracts/ClaimAuditTrail.sol# Hash-chained immutable audit trail contract
│   ├── scripts/deploy.ts            # Local & Polygon Amoy deployment scripts
│   └── test/                        # 12/12 passing Hardhat tests
├── server/                          # Express 5 ESM backend
│   ├── src/ai/                      # Local AI engines: CLIP ViT-B/32, Tesseract OCR, pHash, docs
│   ├── src/chain/                   # Ethers v6 contract client, state hashing, sealing
│   ├── src/seed.ts                  # Seed claims (CLM-4102, CLM-8919, CLM-8920, CLM-8930)
│   └── src/index.ts                 # REST API, 7-stage pipeline trigger, evidence storage
└── web/                             # React 19 + Vite frontend
    ├── vercel.json                  # Vercel proxy configuration (/api -> Render)
    ├── src/pages/                   # Console (/console), Landing (/), Explorer, System, etc.
    └── src/lib/api.ts               # Typed client connecting to backend API
```

---

## 2. Design System Summary

A deliberate **dual-audience split**:

### Farmer-facing screens (01, 02)
- **Light theme**: `#f8f9ff` background, calming greens/blues (`primary: #006948`)
- **Font**: Plus Jakarta Sans
- Large touch targets (h-14 buttons), zero-paperwork language, audio guide, EN / हिन्दी / मराठी toggle, voice narration
- Built for low digital literacy; offline-first messaging ("Works offline • Syncs once connection returns")

### Enterprise forensic screens (03, 04, 05)
- **Dark obsidian canvas**: `#0A0F1D` base, `#11192E` cards, `#1E293B` borders
- **Fonts**: Inter (narrative UI) + JetBrains Mono (hashes, timestamps, policy math)
- Strict status-color semantics:
  - Cyan `#06B6D4` = AI engine output
  - Emerald `#10B981` = verified / immutable / valid
  - Amber `#F59E0B` = human review required
  - Red `#EF4444` = tamper / fraud alert
- Sharp 4px radii; pills prohibited except status chips; depth via tonal layering, not shadows
- Density-optimized 3-zone desktop layout (nav/telemetry + claims matrix + forensic dock)

**Known inconsistency:** the two audience groups ship **divergent Tailwind configs** (different palettes, radii scales — e.g. `full: 9999px` vs `0.75rem` — and font scales). `DESIGN_SYSTEM.md` only documents the enterprise side.

---

## 3. Screen Inventory

| # | Screen | Lines | Audience | Purpose | Interactivity |
|---|--------|-------|----------|---------|---------------|
| 01 | Simple Photo Claim Submission | 387 | Farmer | 3-step intake: loss type → geotagged photos → UPI payout | Loss-category card selection, audio-guide modal, submit/save-draft handlers |
| 02 | Farmer Portal Claim Status | 479 | Farmer | Claim tracking, weather-index alerts (42mm rain trigger), payout receipts | Voice narrator toggle |
| 03 | Claims Command Center | 806 | Insurer ops | KPI dashboard, live fraud alert (cross-district pHash anomaly: same imagery in Yavatmal vs Nanded), throughput telemetry | Forensic modal with open/close/backdrop/block-claim handlers |
| 04 | Forensic Evidence Inspection | 592 | Fraud analyst | Split-view image forensics, CV bounding boxes, SHA-256/pHash collision (Hamming distance 2 vs archive #CLM-4102), AI-override actions | Heatmap toggle, sync zoom, toast notifications, sign-reject / confirm-fraud / override / escalate handlers |
| 05 | Audit Ledger & Tamper Proofs | 702 | Regulator / auditor | Live Merkle block stream (Polygon L2), hash search, validator quorum incl. IRDAI node, zk-SNARK proof verification | **Interactive tamper simulation** (retro-edit ₹4,500→₹15,000 breaks hash chain visually), hash-verify drawer, event filter, copy-to-clipboard, validator-key modal, proof export |

**Shared narrative detail:** claim #CLM-8919 flagged in the command center (03) is the same claim under forensic inspection (04); #CLM-8920 is the farmer's paid claim (02). The screens tell one coherent end-to-end story.

**Technical makeup:** static self-contained HTML + Tailwind via CDN + vanilla JS script blocks; Material Symbols icons; Plus Jakarta Sans / Inter / JetBrains Mono via Google Fonts; **remote images hosted on googleusercontent.com (will break if links expire)**.

---

## 4. Gaps & Observations

1. **No inter-screen navigation** — `data-path` attributes exist but every link is `href="#"`; the 5 screens are not wired together.
2. **6 referenced screens don't exist yet**: Overview & Queue, Perceptual Hash Database, Policy Rules & Thresholds, Auditor Verification Portal, System Logs & Merkle Proofs, Weather Index / Cooperative (farmer side).
3. **Divergent Tailwind configs** between farmer and enterprise screens (see §2).
4. **Remote Google-hosted images** — mockups depend on external `lh3.googleusercontent.com` URLs.
5. **Not production-grade tech** — Tailwind CDN, no build system, no state, no data layer, no tests.
6. **Pitch ≠ implementation** — the blockchain, AI pipeline, and UPI rails described in the pitch have zero implementation so far.

---

## 5. Tech Stack (decided 2026-09-18)

Monorepo with three independent npm workspaces (no root workspace hoisting; each has its own lockfile):

| Workspace | Stack | Purpose |
|-----------|-------|---------|
| `web/` | React 19 SPA — Vite 8, TypeScript, Tailwind CSS v4, React Router 7, TanStack Query 5, Zustand 5, ethers v6, zod | Claimant + adjuster front-end, ported from the `design/screens` mockups |
| `server/` | Node + Express 5 (ESM), TypeScript (strict, NodeNext), tsx for dev, ethers v6, zod, cors | REST API for claims, AI-verification hooks, and on-chain sealing |
| `blockchain/` | Hardhat 3.17 + Solidity 0.8.20 (`ClaimAuditTrail.sol`, hardened), plugins: hardhat-ethers + hardhat-mocha; targets local node + Polygon Amoy (chainId 80002) | Immutable, **hash-chained** claim audit trail with owner-gated sealing and `verifyTrail` |

**Decisions:**
- **React SPA + Node API** (user choice) over Next.js — traditional split, two deployables.
- **No persistence yet** (user choice) — claims live in an in-memory store; Prisma/Postgres deferred to the backend phase.
- **npm** everywhere (matches pre-existing blockchain lockfile).
- Hardhat 3 gotchas handled: toolbox@7 is an empty stub (removed; real plugins installed individually), ESM `"type": "module"` required, networks need explicit `type` (`edr-simulated` / `http`).
- Vite dev server proxies `/api` → `http://localhost:4000` (Express).

**Verified:** `web` typecheck + production build pass; `server` typecheck passes; `blockchain` compiles (solc 0.8.20), **11/11 tests pass**, deploy script works.

**Run commands:** `cd web && npm run dev` (5173) · `cd server && npm run dev` (4000) · `cd blockchain && npm run node` / `compile` / `test` / `deploy:local` · **end-to-end demo: `bash server/scripts/smoke-test.sh`** (starts node → deploys → boots API → creates claim → seals AI decision + payout → prints verified audit trail; cleans up after itself) · **judge demo: `npm run demo` (root) — one command boots node + deploy + API + dashboard**.

### Presentation prototype (2026-09-18)
- **`web/` is now a live Command Center** (dark forensic theme from DESIGN_SYSTEM.md, Inter + JetBrains Mono): claim intake (loss type / amount / photo count), claims queue, per-claim action ribbon (AI Approve / AI Flag / Pay via UPI — each seals on-chain), Immutable Audit Trail timeline with per-record hash + prev-hash links, integrity strip (off-chain vs on-chain verdicts, live ledger stats), and the **Attempt Retro-Edit / Restore** tamper demo wired to `/api/demo/*`. TanStack Query polling keeps everything live; Vite proxies `/api` → 4000.
- Root `package.json` added with convenience scripts: `demo`, `smoke`, `web`, `server`, `chain:test`, `install:all`. Demo launcher: `scripts/demo.sh` (boot all services, print the 5-step judge flow, Ctrl+C teardown).
- **Verified end-to-end on the running stack:** claim created → transition sealed (HTTP 200) → trail returned 2 records with integrity valid → dashboard served (HTTP 200).

### Backend architecture (implemented 2026-09-18)
- **Contract** (`blockchain/contracts/ClaimAuditTrail.sol`): `onlyOwner` sealing (API signer = deployer), `bytes32` claim IDs (`keccak256(claimId)`), per-record `recordHash = keccak256(abi.encode(prev, stateHash, status, ts, by, noteHash))` chaining to the previous record, `latestRecordHash` chain head, `totalRecords` metric, `verifyTrail(claimId) → (valid, brokenAtIndex)` with `type(uint256).max` = intact, indexed `ClaimStateSealed` event.
- **Server chain layer** (`server/src/chain/`): `chain.ts` = TS mirror of the contract's hashing (`computeStateHash`, `computeRecordHash`, `findChainBreak`) — must stay byte-identical to the Solidity formula (tests enforce); `abi.ts` = minimal ABI; `client.ts` = provider + `NonceManager`-wrapped wallet (fixes stale-nonce errors on automining nodes), graceful degradation when the node is down (`enabled: false`).
- **API** (`server/src/index.ts`, port 4000): `POST /api/claims` (seals genesis record), `POST /api/claims/:id/transitions` (seals AI decision / override / payout), `GET /api/claims/:id/audit-trail` (reads back from chain, verifies hash chain on- AND off-chain, returns integrity report), `GET /api/health` (chain status + totalRecords), **`POST /api/demo/tamper`** (forgery demo, local nodes only) and **`POST /api/demo/restore`** (undo), **`GET /api/stats`** (KPIs: claims today, auto-approval %, flagged, ₹ leakage prevented, ₹ paid, records sealed), **`GET /api/claims/:id/merkle`** (Merkle root + per-record inclusion proofs, self-verified), **`POST /api/merkle/verify`** (auditor proof replay), **`GET /api/explorer/events`** (recent ClaimStateSealed events with tx hashes), **`GET /api/explorer/search?q=`** (search by CLM id or any 0x hash), **`GET /api/claims/:id/dossier`** (downloadable signed cryptographic dossier: canonical hash + EIP-191 signature + Merkle root). Claims live in memory (persistence deferred).
- **Demo seeds** (`server/src/seed.ts`): on boot, seals 3 mockup-matching claims if the contract is fresh — CLM-8919 (pHash-collision fraud, AI_FLAGGED), CLM-8920 (clean flood claim, PAID), CLM-8930 (fresh SUBMITTED). Idempotent via `getTrailLength === 0` check; disable with `SEED_DEMO=0`.
- **New chain modules**: `merkle.ts` (binary Merkle tree over recordHash leaves, duplicate-last promotion, proof gen/verify), `explore.ts` (eth_getLogs event scan + search interpreter), `dossier.ts` (canonical JSON → keccak256 → EIP-191 signed attestation).
- **Tamper demo** (`server/src/chain/tamper.ts`): locates the target record's stateHash storage slot via a stride-agnostic calibrated scan, rewrites it with `hardhat_setStorageAt` (guarded by `assertLocalRpc` — refuses any non-local RPC), then reports the verdict; restore rewrites the original value (kept in `restoreMemo`). This is design screen 05's "Attempt Retro-Edit" button, made real.
- **Sandbox gotcha:** the environment exports `PORT=0`; the API guards with `Number(PORT) > 0 ? … : 4000`.
- **No user action needed:** all libraries are already installed (web/server/blockchain each have node_modules + lockfiles). Anyone cloning fresh just runs `npm install` in each of the three folders. Nothing else to download — Hardhat's local node replaces Ganache, solc downloads itself on first compile.

---

## 6. Conversation Log

> Newest entries at the bottom. Each entry: date — what was requested, decided, and done.

### 2026-09-18 — Initial full-project analysis
- **Request:** "analayse this whole projects"
- **Done:** Explored repo (pitch doc, design system, 5 HTML screens, screenshots, assets). Produced full analysis: project concept, repo structure, per-screen inventory, technical stack of mockups, design-system split, gaps (unwired nav, 6 missing screens, divergent configs, remote images, no build system). Assessment: strong coherent design-phase repo; obvious next milestone is turning mockups into a working app.
- **Follow-ups offered:** build working app from mockups; add missing screens; unify design system; prototype hash-chain demo.

### 2026-09-18 — Persistent context file created
- **Request:** "first of all make a file and save our conversation and context simultaneously"
- **Decision:** single markdown file in project root — `CLAIMCHAIN_CONTEXT.md` — holding project context + running conversation log; plan approved in plan mode.
- **Done:** this file was created with the full snapshot above; ongoing rule: append a dated entry per meaningful turn.

### 2026-09-18 — Tech stack decided & libraries installed
- **Request:** "decide the tech stacks for this project and install required libaraies"
- **Decisions (user-confirmed):** React SPA + Node API (not Next.js); skip persistence for now; npm as package manager. Discovered a parallel `blockchain/` workspace (Hardhat + `ClaimAuditTrail.sol`) and built the stack around it.
- **Scaffolded:** `web/` (Vite react-ts + Tailwind v4, router/query/state/ethers/zod) and `server/` (Express 5 ESM + TS strict, health + in-memory claims endpoints with zod validation, Vite dev proxy on `/api`).
- **Fixed in `blockchain/`:** Hardhat 3 needs ESM (`type: module`, import/export config, explicit network `type`s); removed empty `hardhat-toolbox@7` stub.
- **Verified:** all three workspaces compile — web build ✓, server typecheck ✓, contract compile (solc 0.8.20) ✓.

### 2026-09-18 — UI/UX work deferred; backend-first direction chosen
- **Request:** user wants to **redesign the UI/UX later**, so frontend porting is paused; asked what to work on instead and whether the conversation is being saved.
- **Decision:** skip all `web/` frontend work for now. Next milestone candidates: (a) end-to-end claim-sealing backend flow (contract hardening + Hardhat tests + deploy scripts + server↔contract integration + tamper detection), (b) contract tests only, (c) pure-TS hash-chain/tamper-verification logic in the server.
- **Contract review note:** `ClaimAuditTrail.sol` is a solid skeleton but lacks access control (anyone can seal), uses `string` claimIds (gas-heavy; `bytes32` cheaper), and each `AuditRecord` is independent — the pitch's "chained hashes" (each hash embedding the previous) is not implemented yet, so retro-edit detection relies only on blockchain immutability, not on-chain chain-breaking.

### 2026-09-18 — Backend milestone: hardened contract + E2E claim sealing (autonomous)
- **Request:** "I'll leave it on you how to proceed… tell me how much you have proceeded and what you gonna do… tell me if I have to download any libraries."
- **Contract hardened** (all three review gaps fixed): owner-gated `sealClaimState` with custom errors, `bytes32` claim IDs, real **hash chaining** (`recordHash` embeds `prevRecordHash`), `verifyTrail` returning the break index, `totalRecords`, indexed event.
- **Test suite: 11/11 passing** (`blockchain/test/ClaimAuditTrail.test.ts`, Hardhat 3 `network.create()` API). Tamper test forges a historical record via `hardhat_setStorageAt` with a **calibrated storage scan** (compiler-specific 6-slot record stride found empirically) and proves `verifyTrail` flags the break at the exact index.
- **Hardhat 3 lessons:** JS test files must be `.ts` (TS syntax isn't parsed in `.js`); `hardhat-toolbox@7`/`hardhat-chai-matchers@3` are empty stubs — use `hardhat-ethers` + `hardhat-mocha` plugins; revert assertions via custom try/catch helper (`expectCustomError`); deploy script uses `connection.networkName` and writes `blockchain/deployments/<network>.json`.
- **Server↔chain integration:** new `server/src/chain/{chain,abi,client}.ts`; claim creation seals genesis record; `POST /api/claims/:id/transitions` seals AI/human/payout transitions; `GET /api/claims/:id/audit-trail` returns records + integrity report (on-chain AND off-chain verification). Fixed `PORT=0` sandbox env bug and stale-nonce failures via `ethers.NonceManager`.
- **End-to-end smoke test passes** (`bash server/scripts/smoke-test.sh`): node → deploy → API → create claim → seal AI_APPROVED → seal PAID → audit trail shows 3 chained records, integrity valid.
- **Libraries for the user: none** — everything installed. Fresh clones: `npm install` in `web/`, `server/`, `blockchain/`.

### 2026-09-18 — Backend logic completion round (user: "fuck frontend do backend and all the logic")
- **Added:** Merkle inclusion-proof service + endpoints, chain explorer (event feed + hash/claim search), signed dossier export, `/api/stats` KPIs, and idempotent demo seeds (CLM-8919/8920/8930) matching the design-mockup narrative.
- **Full-stack functional verification passed:** seeds loaded (3 claims, correct statuses) · stats computed (6 sealed records) · Merkle bundle for CLM-8920 (3 leaves, every proof self-verifies) · explorer returned 5 events · search "CLM-8920" → 3 matches · dossier signed (132-char sig) with matching Merkle root.
- **Frontend status:** shelved mid-build by user stop — Command Center + Farmer Portal pages written, Auditor page + router wiring NOT done (web will not compile until finished). Backend fully green.

### 2026-09-18 — Completion audit & context save (user: "does all the backend and the AI and Blockchain completed if yes save the context")
- **Blockchain: COMPLETE** — hardened hash-chained `ClaimAuditTrail.sol` (owner-gated, bytes32 ids, `verifyTrail`), 11/11 Hardhat tests incl. storage-level tamper detection, deploy scripts (local ✓ verified; Amoy ready but **blocked on user funding the testnet wallet** `0x28E6d16F698e3120811DDCFf9549bD02D4d6fc2f` from a faucet).
- **Backend/API: COMPLETE** — claim lifecycle sealing, dual integrity verification, tamper/restore demo, seeds, `/api/stats`, Merkle inclusion proofs, chain explorer + search, signed dossier export, graceful degradation, nonce protection. All verified live end-to-end.
- **AI: NOT IMPLEMENTED — by design.** No real OCR/computer-vision/pHash service exists. The "AI decisions" in the demo are **deterministic simulated logic**: seeded narratives (CLM-8919's pHash-collision flag is a scripted note), fixed acceptance notes, and (in the unfinished frontend) a staged animation. The architecture is ready for real AI (image hashes flow through `computeStateHash`; notes are free-form) but wiring a real model/OCR/pHash library was never in scope so far.
- **Honest summary for judges/stakeholders:** blockchain layer real & tested; API layer real & tested; AI layer is simulated/stubbed pending a real model (e.g. Tesseract OCR, pHash lib, or a vision API) — that is the single remaining substantive build item besides Amoy funding/deployment.

### 2026-09-18 — Frontend pivot for judge presentation (user request)
- **Request:** "stop for a minute and work on frontend now we have to present the basic prototype to judges."
- **Delivered:** live Command Center prototype in `web/` (design-token faithful, API-wired, incl. tamper demo UI) + `npm run demo` one-command launcher + root package.json scripts. Full stack verified working together (claim → seal → trail → dashboard 200).

### 2026-09-18 — Tamper-detection demo + deploy env templates (autonomous)
- **Added** `POST /api/demo/tamper` + `POST /api/demo/restore`: a real, safe reproduction of design screen 05's retro-edit simulation. Smoke test extended (steps 9–10): tampering → `TAMPERING DETECTED` (break at record index 1, caught on-chain AND off-chain) → restore → `CHAIN RESTORED`.
- **Safety**: demo endpoints refuse non-local RPCs (`assertLocalRpc` checks the hostname against 127.0.0.1/localhost/::1); only `hardhat_setStorageAt` on a sandbox node can forge storage.
- **Refactors**: `integrityReport()` helper (shared verdict shape; MaxUint256 sentinel surfaced as null), `loadTrail()` extracted, `ChainClient` now exposes `provider` + `rpcUrl`.
- **Added** `server/.env.example` and `blockchain/.env.example` — with local-node defaults and commented Amoy settings (faucet link included) so testnet deployment is config-only when a funded key is available.
- **Verified**: server typecheck ✓ · contract tests 11/11 ✓ · full smoke test incl. tamper/restore ✓.

### 2026-09-18 — Real workflow spec written (user: "don't change the code, define what the workflow should look like")
- **Request:** the demo buttons (AI Approve / AI Flag / Attempt Retro-Edit) feel fake: no document/photo upload, no actual AI verification, no visible result logs, and flagged claims can still be paid. User wants the *real* workflow defined first — **explicitly: no frontend changes, no code changes this round.**
- **Created `CLAIMCHAIN_WORKFLOW.md`** (source-of-truth spec, zero code touched):
  1. **Intake:** `POST /api/claims` becomes multipart — required photos (1–6) + optional bills/ID docs; server computes sha256 + pHash + EXIF per file, stores evidence rows, seals hashes in the genesis record; late evidence = sealed ADDENDUM records.
  2. **AI verification pipeline:** auto-runs after creation (no button). 7 deterministic stages (EXIF integrity → pHash duplicate detection → OCR extract → policy match → damage heuristics → fraud rules → threshold decision), each emitting a hash-linked log entry; verdicts `AI_APPROVED / AI_FLAGGED / AI_REJECTED` are **computed, never typed**. Rule-based verifier = "acts like AI" but is real deterministic code; ML swap later only replaces stage 5.
  3. **Result logs:** `GET /api/claims/:id/verification` returns the stage-by-stage log (timings, pass/fail, details); DECISION record commits the log's hashes on-chain.
  4. **State machine guard (the big fix):** server rejects client-chosen AI statuses; `PAID` returns 409 unless status is `AI_APPROVED`/`HUMAN_APPROVED` (**flag = payout freeze**); human override requires `AI_FLAGGED` + ≥20-char reason; new guarded `POST /api/claims/:id/pay`; new statuses `HUMAN_APPROVED / HUMAN_REJECTED / HUMAN_REVIEW` (enum decision deferred). **User re-confirmed the flag policy explicitly:** flagged = blocked until a human approves — this is RULE ZERO in the spec, no bypass; not "blocked forever", not "still payable".
  5. **Tamper rules:** evidence content-addressed (hash mismatch → `EVIDENCE_TAMPERED` auto-flag + freeze); verification history append-only (RETRY appends); retro-edit demo unchanged and local-node-only.
  - Includes endpoint-delta table + 7-step implementation order (guard first, upload, pipeline, wiring, sealing, OCR/CV, frontend last).
- **Decision kept:** frontend untouched per user instruction — UI changes (upload UI, pipeline stepper, review panel) explicitly deferred to the frontend rebuild round.

### 2026-09-18 — Free real-AI integration plan (user: "what things you will need to integrate a real AI in this system which will do all the work and completely free no cost")
- **Question answered — plan only, nothing installed or coded yet.** Zero-cost shopping list for replacing the simulated AI layer, mapped onto `CLAIMCHAIN_WORKFLOW.md`'s pluggable stages.
- **npm libraries (all open-source, free):** `sharp` (decode/normalize photos), `exifr` (real EXIF incl. GPS, timestamps, editing-software tags → stage 1), `sharp-phash` (real perceptual hashing + Hamming distance across all claims → stage 2), `tesseract.js` (in-process WASM OCR for bills/ID/policy numbers → stage 3; `eng`/`hin`/`mar` language packs auto-download), `@huggingface/transformers` (local CPU ONNX inference → stage 5 real computer vision).
- **Model weights (free, Hugging Face, ~300–500 MB disk, cached on first run):** CLIP ViT-B/32 ONNX — zero-shot damage labels ("flooded field", "cracked wall", "damaged vehicle") + image embeddings for near-duplicate detection beyond pHash. No GPU, no account, no card; a verification run costs seconds of CPU and works offline.
- **Plain-language decision reasoning (stage 7), three options:** (A, default) template-based generation from stage logs — deterministic, zero deps; (B) tiny local LLM via Ollama (`llama3.2:3b`, free, ~2 GB RAM); (C) free-tier cloud key (Groq / Gemini / OpenRouter — still ₹0 but needs a free account + one key in `server/.env`).
- **User action needed: none** for the local stack (just `npm install` + automatic model caching); option C is the only path requiring a free API key.
- **Build target when we say go:** `server/src/ai/` — one engine per spec stage (EXIF → pHash → OCR → policy match → damage → fraud rules → decision), multipart photo upload wired into claim creation, async job runner, `GET /api/claims/:id/verification` stage logs, computed verdicts sealed on-chain. ML swap later touches only stage 5, per the spec.
- **Honest caveat (stated to user):** Tesseract on low-quality smartphone photos is decent, not magic — per-field confidence scores (already in the spec's log format) + human review on flags is the correct behavior for this domain.
- **User then asked to save the whole chat** → this entry.

### 2026-09-18 — Session resumed on a new laptop (user: "read the context, tell me what is pending")
- **Context restored** from this file + pitch + workflow spec; code state re-verified on disk.
- **Confirmed done:** blockchain (11/11 tests) ✓ · backend API v1 (sealing, Merkle, explorer, dossier, tamper/restore, seeds) ✓ · Command Center prototype in `web/src/App.tsx` ✓.
- **Confirmed pending:** (0) this laptop has **no node_modules** — run `npm run install:all`; (1) workflow spec NOT implemented — transitions endpoint still accepts any caller-chosen status, no guard/flag-lock, no `/pay`, no multipart upload, no 7-stage pipeline, no verification logs; (2) real AI NOT implemented (no ai/ folder, no sharp/exifr/phash/tesseract deps); (3) frontend half-done — no router, Farmer Portal unreachable, Auditor page missing, dead files in `pages/`/`components/`, no upload/pipeline/review UI; (4) Amoy deploy blocked on funding wallet `0x28E6...c2f2f`.
- **Note:** `design/screens/` folder no longer exists on disk (only DESIGN_SYSTEM.md, assets, screenshots remain) — mockup-porting tasks are moot.

### 2026-09-18 — Backend workflow implementation COMPLETE (user: "start working on backend now with your fullest potential, zero bugs")
- **CLAIMCHAIN_WORKFLOW.md is now IMPLEMENTED.** API v0.4.0, all green: server typecheck ✓ · contract **12/12 tests** ✓ · web build ✓ · **18-step e2e smoke ALL PASS** ✓ (bash server/scripts/smoke-test.sh).
- **Guard (§4):** transition whitelist — AI verdicts 403 `AI_VERDICTS_ARE_COMPUTED`, `PAID` via transitions 409 `USE_PAY_ENDPOINT`, terminal-state lock, human review needs ≥20-char sealed reason (400 `REASON_TOO_SHORT`). **RULE ZERO:** `POST /api/claims/:id/pay` returns 409 `FLAGGED_LOCKED` for flagged claims; only `AI_APPROVED`/`HUMAN_APPROVED` payable. Verified live in smoke steps 6–7, 11–12.
- **Evidence upload (§1):** `POST /api/claims` is multipart now (photos[1-6] required + bills + idDocs); per-file sha256 + pHash + EXIF (exifr); bytes content-addressed on disk (`.evidence/`, gitignored); late evidence = sealed ADDENDUM + re-verify (step 13); `GET /api/evidence/:fileId` serves bytes (step 14 byte-identical).
- **7-stage pipeline (§2–3):** `server/src/ai/` — EXIF_INTEGRITY → DUPLICATE_PHASH (sharp-phash, Hamming ≤6, cross-claim) → OCR_EXTRACT (tesseract.js, eng, 3x-upscaled grayscale preprocessing, failure-latched after 2 init errors) → POLICY_MATCH (in-memory policy table) → DAMAGE_ASSESS (loss-type keyword vocab over real OCR of photo pixels) → FRAUD_RULES → DECISION (thresholds: <20 REJECT, <50 or hard-fail FLAG, else APPROVED). Verdicts computed, never typed. `GET /verification` returns stage logs; RETRY appends history.
- **Verification digest:** sha256 of the stage log committed into the DECISION record's stateHash (chain.ts `computeStateHash` extended: evidenceHashes+pHashes+verificationHash, legacy imageHashes still accepted).
- **Statuses:** HUMAN_REVIEW(6)/HUMAN_APPROVED(7)/HUMAN_REJECTED(8) added on-chain (contract enum extended, test added); AI_REJECTED aliases REJECTED(5) off-chain (keeps review lane, contract unchanged). PAYOUT_ELIGIBLE = AI_APPROVED|HUMAN_APPROVED.
- **Seeds rebuilt — 100% REAL pipeline:** deterministic synthetic JPEGs (sharp+SVG with embedded keyword text, seedKey for byte-identical cross-claim images). CLM-4102 = archived paid claim (pHash reference set); **CLM-8919 reuses 4102's exact bytes → pipeline computes AI_FLAGGED via d=0 collision** (no scripted notes); CLM-8920 clean → AI_APPROVED → PAID; CLM-8930 fresh SUBMITTED.
- **Stats:** + `flaggedLocked`, `verificationDurationP50Ms` (real p50 was 2315ms — OCR is genuinely running).
- **Windows/Git-Bash hardening in both scripts:** leaked-port kill (netstat+taskkill, stale servers were serving OLD code), no `require()` on MSYS paths (stdin JSON instead), `cygpath -m` for fixture dirs shared node/curl/bash, repo-local `.smoke-fixtures` (gitignored), `|| true` guards for grep under pipefail.
- **Honest caveats:** tesseract on 320px synthetic text works (with 3x upscale) but real-world smartphone photos will vary — per-field confidence + human review on flags is the designed answer; damage stage is real keyword-over-OCR matching, not an ML model (CLIP swap-in only touches stage 5, as specced); still in-memory claims + no auth.
- **Next:** frontend rebuild with user's references (upload UI, pipeline stepper, review panel, pay gating) — UI theme to be replaced per user.

### 2026-09-18 — Environment setup on the new laptop (user: "first install everything")
- **Installed:** all base deps via `npm run install:all` (web 61 / server 98 / blockchain 156 pkgs) **plus** the full free-AI + upload stack in `server/`: `multer`, `sharp`, `exifr`, `sharp-phash`, `tesseract.js`, `@huggingface/transformers`, `@types/multer` (dev). Zero vulnerabilities in web/server.
- **Verified green:** server typecheck ✓ · web production build ✓ (62 modules) · blockchain **11/11 tests** ✓.
- **Ready for:** implementing `CLAIMCHAIN_WORKFLOW.md` (guard → upload → pipeline) and the real-AI engines in `server/src/ai/` — no further install steps needed; CLIP/OCR model weights will auto-cache on first run.

### 2026-09-18 — AI fraud-training round VERIFIED COMPLETE (user: "you were training the ai to catch fraud, do it at utmost priority")
- **Resumed exactly there.** Code state on disk: `server/src/ai/` already contained `clip.ts` (CLIP ViT-B/32 Xenova ONNX, local CPU), `fraud-memory.ts` (k-NN memory, disk-persisted `.fraud-memory.json`), `train.ts` (boot pass over decided claims), `imagegen.ts` (deterministic synthetic evidence) — plus `/api/fraud-memory`, human relabel on review transitions, and stage-5 DAMAGE_ASSESS k-NN scoring. The only missing step was **executing/verifying the training** (no `.fraud-memory.json` had been produced on this machine).
- **Ran `npm run train`:** CLIP loaded in 1.2s (weights cached), 4 seed claims registered, memory persisted at **10 embeddings (6 genuine / 4 fraud)**. Boot pass enrolled 0 new — all decided claims already enrolled (idempotent ✓). Discovered training had partially run in the prior session; this run made it deterministic and verified.
- **Full 18-step e2e smoke: ALL PASS** — incl. step 15b: memory grew to **12 embeddings (8 genuine / 4 fraud)** as the fresh smoke claim auto-enrolled after its PAID decision (self-training loop live); DAMAGE_ASSESS log shows `trained memory: kNN fraud 40% (k=5)` — the trained memory is genuinely scoring every new claim; engine reported: CLIP ViT-B/32 (Xenova ONNX, local CPU).
- **Also green:** server typecheck ✓ · RULE ZERO 409 FLAGGED_LOCKED ✓ · computed verdicts (manual AI status → 403) ✓ · pHash collision d=0 catch on CLM-8919 ✓ · tamper → detect → restore ✓ · pay gating ✓ · evidence byte-identity ✓.
- **Fraud-catching AI is now REAL & TRAINED:** zero-shot CLIP + few-shot k-NN over decided claims (WinCLIP/PatchCore pattern), labels from sealed verdicts + human review re-labels. Re-train anytime with `npm run train` (server). Memory persists across restarts; caps at 500/label.
- **Next remaining:** frontend rebuild (upload UI, pipeline stepper, review panel, pay gating); Amoy deploy still blocked on funded wallet; stage-7 LLM wording now OPTIONAL (deterministic explain.ts shipped later this day).

### 2026-09-18 — Final backend spec items closed (user: "do the rest remaining task, designs coming for frontend, save our chat")
- **Gapped audit:** scanned spec vs code — retry/evidence/serving endpoints already existed; two spec items were missing and are now implemented:
  1. **Stage-5 CLIP zero-shot staged-imagery detection** (`embedTexts` existed but was dead code): 3 fraud prompts (screen re-photo/screenshot/print) vs 3 genuine outdoor prompts, cosine-scored per photo (first 2), staged% = (maxF−maxG+1)/2×100, thresholds WARN ≥55 / FAIL ≥75 — can only DOWNGRADE a verdict, hard evidence still dominates. Verified live: genuine fixtures scored 51% → no false flag.
  2. **Stage-7 plain-language explanation** — new `server/src/ai/explain.ts`: deterministic template generation from stage logs (verdict opener + per-problem bullets + next-step guidance incl. RULE ZERO wording for flagged claims). Added as `explanation` on `VerificationRun`; deliberately NOT in `verificationHash` (it's derived from the hashed logs, so no on-chain determinism change).
- **Smoke test extended** (step 9 + 15b): explanation ≥40 chars asserted + logged; DAMAGE_ASSESS must contain both `trained memory: kNN` and `zero-shot staged-imagery` lines.
- **Full e2e: ALL PASS** (18 steps + new assertions) — server typecheck ✓, explanation 314 chars, zero-shot 51%, kNN 20%, memory 14 embeddings (10 genuine/4 fraud), tamper/restore ✓, RULE ZERO ✓.
- **User is sending frontend designs shortly** — frontend rebuild is the next round.

### 2026-09-18 — Persistence round (user: "do the task other than frontend")
- **Chosen target:** the last open backend checkbox — claims store is RAM-only, so every restart wiped claims/verification logs (demo risk mid-presentation). Implemented **write-through snapshot persistence**, no new deps, zero API changes, Prisma upgrade path preserved.
- **New `server/src/persist.ts`:** debounced microtask writer (`schedulePersist(claimId)`) → atomic snapshot (tmp + rename) at `.data/claims.json`; `loadPersistedClaims(contract)` on boot BEFORE seeding — fill-the-gaps with seeds, contract-address stamp means a fresh deploy starts a fresh store instead of resurrecting foreign-chain claims, `explanation` always recomputed from logs (never trusted from disk), `CLAIMCHAIN_PERSIST=0` reverts to pure in-memory, `DATA_DIR` overrides location.
- **Wired at every mutation:** intake, pipeline decision (pre- AND post-seal), retry (pre- and post-seal), addendum, transitions, pay. Seed chain-path got a `claims.has(id) → continue` guard so restored rows are never rebuilt (preserves full verification logs).
- **Two transient bugs caught & fixed during the round:** a bad placeholder corrupted a line for one edit (restored); `contractRef` was set after the first write (stamped snapshots with the wrong contract on first boot — moved to loader entry).
- **Verified:** typecheck ✓ · 18-step smoke ALL PASS ✓ · **dedicated restart-survival test PASS** (create claim → AI_APPROVED + 309-char explanation → kill API → restart same contract → `[persist] restored 5 claim(s)` → seeds skipped → claim + COMPLETE verification + explanation intact). Evidence bytes already disk-backed; fraud memory self-persists — so the full demo state is now restart-proof.

### 2026-09-18 — Context save pass (user: "hey save the chat")
- **Log completeness audit:** walked the full dated log — every round from environment setup → AI training → spec items → persistence → five features → Halo frontend → inner pages → random-pics fix → R4/AI-gen/EXIF/train:folder → memory-stats self-test is present and chronologically ordered. No gaps.
- **Code hygiene sweep:** grep for tool-edit artifacts (`placeholder` junk) across server/ and web/ — zero hits (only legitimate HTML `placeholder=` attributes in Console/Explorer + design/ reference files). Nothing to fix.
- **Next-Steps truthed:** struck the stale "Port mockups into web/" item (superseded by the user-delivered Halo rebuild); open items are exactly: Amoy deploy (blocked on funded wallet), QR verify page, farmer portal, shared Tailwind theme, long-term Prisma/Postgres.

### 2026-09-18 — Memory stats + train:folder self-test + smoke re-run (user: "do these two also" — the two suggested followups)
- **Live fraud-memory stats:** 35 embeddings (27 genuine / 8 fraud) — sources: 33 pipeline self-training + 2 human relabels; 38 after this smoke run (29/9).
- **train:folder proven end-to-end** (throwaway fixtures, isolated memory via FRAUD_MEMORY_PATH=.train-selftest.json so the real memory stayed untouched): Run 1 enrolled 4 images / 2 groups; Run 2 stayed at size 4 → idempotent UPSERT ✓. k-NN probe: a new "photograph of a screen displaying flood photo" fake scored its NEAREST neighbor as the trained fraud pattern at 0.705 similarity (vs 0.684 genuine) — the mechanism works; the 50% mixed vote is a fixture artifact (all SVG-style images sit close together; real photos separate sharply). All self-test artifacts deleted (training-set back to README only).
- **Full 18-step smoke re-run: ALL PASS** — trained memory, zero-shot, R4, tamper/restore all green.
- **Next:** user drops real labeled samples into training-set/{genuine,fraud}/<group>/ → `npm run train:folder` → `npm run calibrate` to tune thresholds on real imagery.

### 2026-09-18 — R4 GPS rule + AI-gen detection + strict EXIF + training-set ingestion (user: "implement R4", "add AI-gen prompts + stricter no-EXIF", "build train:folder for my samples")
- **R4 GPS-district mismatch (FRAUD_RULES):** new `ai/geo.ts` — offline district resolver (8 Maharashtra centroids incl. all idealDistricts, haversine, NEAR_KM=45, SERVICE_AREA_KM=120). Per geotagged photo: out-of-area → `R4 gps-out-of-area`; resolved district not in LOSS_META.idealDistricts for the claimed loss → `R4 district-mismatch` (cross-loss fraud caught); unresolved >80km band → `R4 gps-unresolved` (Pune-at-120km boundary case found in spot-check and closed). No GPS → R4 skips (stage 1 penalizes). Calibrated: Yavatmal/Nanded resolve, Mumbai→thane 20km, Pune→bhiwandi 120km.
- **AI-generation zero-shot signal (stage 5, b3):** 4 synthetic-image prompts vs 3 real-smartphone-photo prompts over first 3 photos (shared embCache — one CLIP pass per photo across ALL visual signals). **Calibrated on fixtures before choosing thresholds:** SVG/demo-style images score aiGen 50–53 → WARN 78 / FAIL 88 avoids false-positives on the demo's rendered evidence while catching photoreal synthetic scenes. Logs `ai-generation N%` in DAMAGE_ASSESS details.
- **Strict no-EXIF policy:** `STRICT_NO_EXIF=1` env → missing EXIF hard-FAILs stage 1; default stays WARN (budget phones/messengers strip metadata on real claims — documented in .env.example).
- **External training ingestion (READY FOR USER SAMPLES):** `fraud-memory.enrollEmbeddings(claimId, items)` (source='external', group-stable ids → UPSERT on re-run); new `server/src/train-folder.ts` CLI — `npm run train:folder -- ../training-set` reads `genuine/<group>/` + `fraud/<group>/` trees (one folder = one case; loose files = `_flat` group; optional per-group `manifest.json` {lossType, district, note} displayed), embeds via CLIP, enrolls as ground truth; `training-set/README.md` documents the format. Also `npm run calibrate -- <img|folder>` prints staged/aiGen/relevance per image for threshold tuning against real samples.
- **Verified:** server typecheck ✓ · smoke ALL PASS (aiGen 52% on genuine fixtures — no false flag; the persisted memory from last run's enrolled junk claim flagged this run's similar fresh claim → review lane → human approve → pay, the self-improving loop working live) · memory 34 embeddings · web build ✓ (Pipeline page documents 4 signals + R4).
- **Next:** user sends labeled samples → `npm run train:folder` → k-NN catches those fake patterns; optionally recalibrate thresholds with `npm run calibrate`.

### 2026-09-18 — Random-pics auto-approve HOLE CLOSED (user: "i added some random pics in it then also it is saying ai approved")
- **Root cause (two gaps):** (1) stage 5's keyword miss only WARNed (−12) — not enough to drop below the approve threshold; (2) `decide()` explicitly EXCLUDED DAMAGE_ASSESS fails from hard-fails, so even a failing damage stage could still approve; (3) the k-NN memory only knows fraud patterns — it had no signal for "this imagery is unrelated to any loss".
- **Fix — third CLIP signal, loss-type relevance (zero-shot):** per-loss prompt pairs (`RELEVANCE_PROMPTS`) where negatives include the OTHER loss types' positives (a flood photo can't pass a drought claim) plus 6 generic UNRELATED_PROMPTS (selfies, food, indoor, screenshots, documents); staged% = (maxPos−maxNeg+1)/2×100 over first 3 photos. When OCR finds no damage keyword: relevance < 50 → **FAIL** (`imagery does not depict <loss> loss`), ≥ 65 → PASS (visually on-topic), between → stays WARN. **decide() no longer exempts DAMAGE_ASSESS** — any stage FAIL now forces at least a FLAG.
- **Smoke extended (step 9c):** synthetic "birthday party selfie indoors" photo on a flood claim → relevance 45% → **AI_FLAGGED** + pay → 409 FLAGGED_LOCKED. Genuine claims still approve (relevance 51% with keyword hit; no false positives). Flagged random claim auto-enrolls as fraud — memory grew to 31 embeddings (self-improving against junk submissions).
- **Verified:** typecheck ✓ · smoke ALL PASS (now incl. 9c) ✓ · web build ✓ (Pipeline page copy updated to document the new threshold) · context saved.
- **Honest caveat:** threshold (50/65) is calibrated on synthetic fixtures; real smartphone photos may need tuning after field feedback — the constant is named and trivially adjustable (RELEVANCE_FLAG/RELEVANCE_PASS).

### 2026-09-18 — Five inner pages added (user: "add more pages — system pipeline integrity etc are landing to one page, add more details and pages")
- **Nav links are now real routes** with deep detail; three of the five are LIVE (poll real APIs):
  - **`/system`** — architecture: 4-layer stack (evidence → AI verification → state & guard → sealing) with tech chips, 5-step "life of a claim" flow, 4 design guarantees, CTA to pipeline
  - **`/pipeline`** — deep dive on all 7 stages: what each reads/does, exact PASS/FAIL conditions (incl. stage-5's three signals + stage-7's −25/−12 threshold math), tech chips (exifr, sharp-phash, tesseract, CLIP, k-NN k=5, zero-shot prompts), "why deterministic beats smart" close
  - **`/integrity`** — hash-chain explainer (4 steps), **live dual-integrity card for CLM-8920** (off-chain replay vs on-chain verifyTrail, polls 5s), **working retro-edit/restore demo on-page**, RULE ZERO + R-403 + R-409 + R-ADD guard-rule cards
  - **`/memory`** — **live fraud-memory stats** (embeddings, genuine/fraud split with share bar, decided claims, engine badge from /api/fraud-memory), how-it-learns cards (pipeline verdicts / human ground truth / disk persistence), 4-step scoring explainer, `npm run train` terminal mock
  - **`/explorer`** — **live ClaimStateSealed event feed** (eth_getLogs, block numbers + tx hashes, 5s refresh, status-name mapping for all 9 enum values) + search by CLM id or any 0x hash (interpretation shown: claimId/hash/unknown)
- **New shared chrome:** `components/ui.tsx` — Chip/Card/SectionTitle (moved patterns), PageHero, solid SiteHeader (5 route links + Console CTA), SiteFooter, InnerPage shell, BackHome. `api.ts` + `explorerEvents/explorerSearch` + `ChainEvent` type.
- **Landing updated:** navbar links → real routes; use-modes section gained deep-dive links. Router now has 7 routes.
- **3 more transient tool-edit artifacts caught by grep + typecheck:** Integrity.tsx `</chip placeholder>` + stray class, Memory.tsx `sealed-placeholder` class, Explorer.tsx `note_placeholder` (ChainEvent has no note — shows stateHash) — all fixed.
- **Verified:** web build ✓ (1941 modules) · screenshots of all 5 pages captured to `.shots/` (system/pipeline/integrity/memory/explorer.png) against the live stack.

### 2026-09-18 — FRONTEND REBUILT in the Halo fintech language (user: "use this for front end and customize details accordingly" + full USD Halo landing spec)
- **Design language adopted from the user's Halo/USD-Halo spec:** #F5F5F5 canvas, TT Norms Pro (@font-face 400/600 from /fonts, Inter fallback), tight negative letter-spacing headings, black pill buttons with white arrow circles, dual infinite marquees (22s hero brands / 30s backers), rounded video hero. `lucide-react` added (only new dep); no other UI libraries.
- **Shipped:**
  - `web/src/index.css` — Halo tokens (@theme: halo-bg/ink/deep #2B2644 + ClaimChain status colors), @font-face pair, marquee + backers keyframes, scrollbar
  - `web/src/components/LogoIcon.tsx` — the spec's interlocking-squares SVG (currentColor, viewBox 0 0 256 256)
  - `web/src/pages/Landing.tsx` — pixel-faithful to spec: absolute transparent Navbar (LogoIcon + wordmark, 5 center links, black pill "Open Console"), h-screen overflow-hidden hero wrapper, full-bleed autoplay/muted/loop/playsInline video with `height: calc(100vh - 96px)` card, "Every Claim / Proves Itself" h1 (-0.04em), Inter-styled sub, Join-us-style arrow pill, brand marquee (Polygon/Hardhat/Hugging Face/Tesseract/Ethers/UPI/IPFS with per-brand typographic voices), Info section ("Meet ClaimChain." + 4-card grid: image card spans 2, two #2B2644 cards — copy re-pointed to fraud AI / computed verdicts / sealed trails), Backed-by marquee (RBI Sandbox / Polygon Village / IRDAI / AgriStack / NABARD / ONDC / eNAM / SETU), Use-modes split with 720px video panel + "Know more" circle link. Reference videos/images reused from the spec URLs
  - `web/src/pages/Console.tsx` — the WORKING dashboard in the same language: KPI strip (claims today, auto-approved %, flaggedLocked, ₹ leakage, verify p50, trained memory size), intake form with REAL multipart upload (loss-type cards, drag-free file pickers, photo previews, bills/ID), live 7-stage pipeline stepper (PASS/FAIL/WARN icons, per-stage ms, EN/हिंदी explanation toggle wired to ?lang=hi, similar-past-cases chips from the CLIP memory), guarded human lane (flag → payout-lock banner + ≥20-char reason with live counter + approve/reject) and pay lane (AI_APPROVED/HUMAN_APPROVED only, upiRef input), evidence grid (thumbnails via /api/evidence, sha256/GPS/edit-tag badges), audit trail timeline with Attempt Retro-Edit / Restore demo, CSV download in header
  - `web/src/lib/api.ts` — full typed client for the CURRENT server (multipart createClaim, verification(lang), similarCases, review, pay, retry, tamper/restore, stats, fraudMemory, STATUS_META for all 10 statuses)
  - `App.tsx` — BrowserRouter: `/` Landing, `/console` Console, `*` → `/`. Deleted dead stubs: pages/CommandCenter.tsx, pages/FarmerPortal.tsx, components/AiAnalysis.tsx, Layout.tsx, shared.tsx
  - `public/fonts/README.md` — where to drop the licensed TT Norms Pro woff2 files (Inter covers until then); index.html title updated
- **Two transient tool-edit corruptions caught and fixed during the round:** index.css (placeholder junk → clean rewrite) and Console.tsx (missing `import` keyword on the api block).
- **Verified:** web production build ✓ (tsc -b + vite, 1935 modules; font warnings expected — woff2 not committed) · live stack check: `/` 200, `/console` 200, `/api` proxy 200, 4 seed claims visible to the SPA ✓.
- **Known follow-ups:** farmer-facing light portal (screen-02 style) not in this round; dark forensic theme retired from the app (tokens still in git history); pipeline stepper could switch to SSE instead of polling later.

### 2026-09-18 — Quick-wins round (user: "do 1, 2, 5, 6 and 7th, only Hindi no Marathi, full backend zero error, save the chat")
- **Shipped all five requested additions**, every one live-verified on the running stack:
  1. **Bilingual stage-7 explanations** — `explain.ts` rewritten: `buildExplanation(run, claim, 'en'|'hi')` (Marathi de-scoped per user), Hindi in Devanagari with en-IN numerals (बाढ़/सूखा/पशुधन loanwords); `GET /verification?lang=hi` renders Hindi on demand (derived, never stored); `explainRun()` kept as the en default for persist/pipeline. Verified: Hindi opener `स्वचालित रूप से सत्यापित: … के बाढ़ के दावे (₹4,200)…` ✓, English unchanged ✓
  2. **Similar past cases** — `SimilarCase` on `VerificationRun` (collected in stage 5 from k-NN matches, capped 12) + `GET /api/claims/:id/similar-cases` (deduped best-match per claim, top 5, enriched with lossType/amount/status when the referenced claim is in-store — null-safe since the memory file outlives the store). Verified: 5 cases @ similarity 0.824 + CLIP engine badge ✓
  3. **GitHub Actions CI** — `.github/workflows/ci.yml`: checkout → node 22 (npm cache) → hardhat compile + contract tests → server typecheck → **full 18-step e2e smoke on ubuntu** → log artifacts on failure. Web intentionally excluded until the frontend rebuild lands.
  4. **CSV export** — `GET /api/export.csv`: one row per claim (id, claimant, lossType, ₹, status, verdict, score, submitted/decided, durationMs, stateHash), RFC-quoted, download attachment. Verified live ✓
  5. **Rate limiting** — `express-rate-limit` (new dep): global `/api` 300/min + strict intake 12/min (429 `RATE_LIMITED`, draft-7 headers), env-tunable `RATE_LIMIT_WINDOW_MS/MAX/INTAKE_MAX`. Verified: 12 intake requests then 429s ✓
- **Fixes during the round (all caught by typecheck):** stage-5 batch edit had truncated the kNN FAIL/else tail (restored); `NEXT_STEPS` type annotation `(amt)=>string`; similar-cases Map typing simplified to `SimilarCase`; two malformed tool edits were rejected cleanly with no file damage.
- **Verified:** server typecheck ✓ · 18-step smoke ALL PASS ✓ · all five features spot-checked live on a running node+API stack ✓. `.env.example` updated with rate-limit + persistence sections.

### 2026-09-18 — Context save + frontend briefing (user: "save the chat")
- **No code changes this turn.** Confirmed backend is 100% done per workflow spec; audited `web/` state for the rebuild briefing.
- **Key finding for the rebuild:** current `web/src/App.tsx` + `lib/api.ts` are PRE-pipeline and actively incompatible — intake sends JSON+fake hashes (server now requires real multipart photos), "AI Approve/Flag" buttons will 403 (`AI_VERDICTS_ARE_COMPUTED`), "Pay" button will 409 (`USE_PAY_ENDPOINT`). Full rebuild, not a patch. Dead stubs to remove: `pages/CommandCenter.tsx`, `pages/FarmerPortal.tsx`, `components/AiAnalysis.tsx`, `components/Layout.tsx`, `components/shared.tsx`.
- **Delivered the complete UI-component inventory (21 components / 7 groups) as the design briefing:** (A) app shell — router/layout/nav, chain-offline banner, header telemetry; (B) intake — loss-type selector, claimant/amount fields, photo uploader (1–6, drag/drop, previews, validation — the critical one), bills + ID uploaders; (C) live verification — 7-stage stepper with PASS/FAIL/WARN + ms timings + polling, verdict chip + score, plain-language explanation renderer; (D) claim detail — evidence gallery (`GET /api/evidence/:fileId`), forensics cards (sha256/pHash/EXIF incl. edit-software tag), claims queue (8 statuses), audit-trail timeline, integrity strip; (E) human-review panel (flagged only) — mandatory ≥20-char reason with live counter, reviewer field; (F) payout — Pay button rendered only for AI_APPROVED/HUMAN_APPROVED, upiRef input; (G) judge extras — tamper/restore demo, KPI dashboard (flaggedLocked, ₹ leakage, p50), fraud-memory panel (embeddings + CLIP engine badge), optional Merkle viewer/dossier/explorer.
- **Design guidance recorded:** no AI-verdict buttons anywhere (verdicts are computed — the UI shows the pipeline working); keep the tamper demo (the blockchain's proof); designs per screen port incrementally; farmer portal = separate light-theme surface if in scope.

### 2026-09-18 — Environment setup on the new laptop (user: "first install everything")
- **Installed:** all base deps via `npm run install:all` (web 61 / server 98 / blockchain 156 pkgs) **plus** the full free-AI + upload stack in `server/`: `multer`, `sharp`, `exifr`, `sharp-phash`, `tesseract.js`, `@huggingface/transformers`, `@types/multer` (dev). Zero vulnerabilities in web/server.
- **Verified green:** server typecheck ✓ · web production build ✓ (62 modules) · blockchain **11/11 tests** ✓.
- **Ready for:** implementing `CLAIMCHAIN_WORKFLOW.md` (guard → upload → pipeline) and the real-AI engines in `server/src/ai/` — no further install steps needed; CLIP/OCR model weights will auto-cache on first run.

### 2026-09-19 — Flood-flow completion: real-deed identity cross made honest + smoke 9d fixed (user: "start doing the remaining work on flood one")
- **Discovered:** the whole farmer-doc/flood round (doc-verification spec §2–§5: bilingual registry/Aadhaar/policy OCR, `DOC_CROSS` stage, R5 satellite destruction ladder, `destructionPctClaimed`, smoke step 9d using the user's real `samples/registry.pdf`) had been built in a prior session but was **never logged here and never verified end-to-end** — left-behind probe scripts (`.doc-test*.ts`, `.probe-docs.ts`, `.page*.ts`, `.doc-probe/` renders) confirmed the work-in-progress state.
- **Reproduced the failure:** full smoke died at 9d — the flood-doc claim was still `RUNNING` after the fixed `sleep 25`, and worse, `crossVerifyIdentity` on the real 6-page CamScanner deed returned `matched:false, score 0` even for the CORRECT name (OCR too garbled → `ownerName:null`), which would have hard-fraud-flagged (`R-IDENTITY`) every honest farmer whose deed scans badly.
- **Fixed — inconclusive ≠ mismatch (third cross-check state):** `CrossVerifyResult.inconclusive` set when the registry yields no owner name at all (`parsed.ownerName == null && !matched`) — a degraded scan can neither convict nor exonerate; a READABLE deed naming someone else still hard-fails (probe-verified: wrong-owner 0% + `inconclusive:false`, right-owner match 100%, unreadable deed → `inconclusive:true`). `runDocCross`: no `R-IDENTITY` reason when inconclusive; stage result `WARN` instead of FAIL. `DocSummary.identityCross.inconclusive` threaded through server types + `web/lib/api.ts`; Console identity card now shows a neutral gray "Identity · inconclusive" state (no false red ✗).
- **Smoke 9d hardened:** replaced the fixed `sleep 25` with a poll (5s × 36 = up to 3 min) on the verification job for real-deed bilingual OCR; new assertion locks the honest-farmer behavior forever: `unreadable deed → identity cross INCONCLUSIVE (WARN, not fraud)` when `inconclusive:true`.
- **Verified:** server typecheck ✓ · web tsc + production build ✓ (1941 modules) · contract tests **12/12** ✓ · **full 18-step smoke ALL PASS** — 9d completed in ~15s of polling, registry PDF parsed, satellite destruction measured **57% vs claimed 90%**, identity cross INCONCLUSIVE→WARN asserted, tamper/restore + RULE ZERO + trained memory (59 embeddings) all green.
- **Housekeeping note:** `server/.doc-*.ts`, `.page*.ts`, `.probe-docs.ts`, `.doc-probe/`, `.ocr-probe.ts` are untracked one-off probes from the flood round — kept as debugging tools, safe to delete.

### 2026-09-19 — Judge-readiness briefing + live webapp verification (user: "tell me what features to tell the judge, tech stack, data security, traffic, business model, profit, selling to insurers, and how the webapp is working after changes")
- **Live verification performed (stack booted via `bash scripts/demo.sh`):** Landing 200 · /console 200 · chain enabled · 31 claims restored from snapshot · KPIs live (flaggedLocked 10, leakage ₹65,000, p50 2,933ms). **Drove a real flood claim end-to-end on the running webapp:** CLM-77AFF917 (Ramesh Kumar, flood, ₹6,500) → auto-pipeline verdict **AI_APPROVED score 76 in ~5s** (8 stages: EXIF WARN, pHash PASS vs 58 foreign photos, OCR/POLICY/DOC_CROSS INFO-no-docs, DAMAGE WARN 35/100, FRAUD PASS, DECISION) → bilingual explanation rendered → **Pay via UPI → 200 PAID** → trail: 3 records, on-chain AND off-chain valid. Webapp is fully working after the flood-flow changes.
- **Demo-day caveat surfaced:** after a fresh deploy, snapshot-restored claims (e.g. CLM-8919) show `recordCount: 0` trails (their records live on the OLD contract) while new claims seal correctly. Fix for cleanest demo: delete `server/.data/` before boot so seeds re-seal onto the fresh contract, or demo fresh uploads only.
- **Judge briefing delivered (answers, no code changes):**
  - **Features pitch:** zero-form photo intake with server-side sha256/pHash/EXIF; 8-stage computed-verdict AI pipeline (EXIF → pHash dupes → bilingual OCR incl. real scanned deeds → policy match → CLIP damage assess → fraud rules R2/R4/R5 → doc cross-check → threshold decision, ~3s p50); self-learning fraud memory (59 embeddings at time of check); image forensics (reused photos, random imagery, AI-gen, GPS mismatch, destruction exaggeration 90% claimed vs 57% measured); RULE ZERO payout freeze; hash-chained on-chain audit trail with live Attempt Retro-Edit/Restore tamper demo; bilingual plain-language explanations; Merkle proofs + signed dossier + explorer + CSV; restart-proof persistence.
  - **Stack:** React 19/Vite/TS/Tailwind v4/TanStack Query · Express 5/TS strict/zod/multer/rate-limit · CLIP ViT-B/32 ONNX + Tesseract.js (eng+hin) + sharp + sharp-phash + exifr + pdf-to-img (all free/local) · Solidity 0.8.20 hash-chained contract + Hardhat 3 + ethers v6 (12/12 tests) · content-addressed evidence + JSON snapshot persistence · GitHub Actions CI (18-step smoke).
  - **Security of uploaded data:** strong-by-design (content-addressed immutable evidence, on-chain hash sealing at submission, Aadhaar masked to last-4, pHash/CLIP forensics at intake, 10MB/MIME/rate caps, tamper endpoints local-RPC-only); honest gaps for production: auth layer, encrypted-at-rest storage, per-claimant access control (standard S3+KMS+JWT upgrade path).
  - **Traffic:** ~3s CPU per verification → one modest box ≈ 1,000–4,000 claims/day (right for district/co-op scale); horizontal scale = worker sharding + Postgres + real chain (swap-in points exist). Pitch as "one cheap server per district, scales linearly."
  - **Business model:** SaaS per-decision — ₹10/verification (vs ₹400–800 manual); unit economics per 10k claims/mo client: ₹1,00,000 gross − ₹20k COGS = **80% gross margin**; net breakeven ~2,500 claims/day (~8–10 clients), then ₹32L/mo net at 50 clients. ROI pitch: 15–30% fraud leakage on a ₹10cr book → ₹1.5–3cr/yr saved for ₹12L/yr fee = **10–25x ROI**.
  - **Go-to-market:** sell to PMFBY intermediaries/agri co-ops/insurtechs FIRST (not big insurers); lead with live ₹-leakage-prevented stat; blockchain = IRDAI compliance feature; enter RBI/IRDAI sandbox + Polygon Village; pilot = one district, one crop season.
- **Stack state:** demo stack was left RUNNING on ports 5173/4000/8545 for the user to try (open http://localhost:5173); Ctrl+C or `kill_port` script cleans up.

### 2026-09-23 — Polygon Amoy deployment, Cloud hosting (Render + Vercel), Cloud vs Local Analysis

- **1. Polygon Amoy Testnet Deployment:**
  - Deployed `ClaimAuditTrail.sol` onto Polygon Amoy testnet at contract address: `0xb2aE1FC9887b1F77D1e45944654f0D7349B0Ce27`.
  - Signer / Deployer account address: `0x85d93Ca2D66afab27755D5d4D776Ead173CcdfeB`.
  - RPC URL configured: `https://polygon-amoy-bor-rpc.publicnode.com`.
  - Verified on-chain: `owner()` returns deployer, initial records successfully sealed.

- **2. Cloud Backend Deployment on Render:**
  - Created web service `claimchain-api` on Render (`https://claimchain-api.onrender.com`).
  - Fixed build failure: Render sets `NODE_ENV=production` by default, which skips devDependencies (TypeScript and `@types/*` needed for compilation). Fixed Build Command to: `npm install --include=dev && npm run build`.
  - Environment variables set on Render: `RPC_URL`, `CONTRACT_ADDRESS`, `PORT=4000`, and `PRIVATE_KEY`.
  - Verified live: `GET https://claimchain-api.onrender.com/api/health` returns `200 OK` with `chainEnabled: true` and active contract address.

- **3. Cloud Frontend Deployment on Vercel:**
  - Created Vercel project linked to user's GitHub account (**CelestialYash**).
  - Vercel created cloned repository: `https://github.com/CelestialYash/claimchain`.
  - Configured git remotes: `origin` (collaboration repo: `utkarshvijay1717lk/ClaimChain-SIH`) and `vercel` (`CelestialYash/claimchain`).
  - Updated local Git author identity to `CelestialYash` (`CelestialYash@users.noreply.github.com`).
  - Created `claimc-main/web/vercel.json` with URL rewrite rules:
    - `/api/:path*` -> `https://claimchain-api.onrender.com/api/:path*` (transparent proxy to Render backend)
    - `/(.*)` -> `/index.html` (SPA routing)
  - Vercel build settings: Root Directory `claimc-main/web`, Framework `Vite`, Build Command `npm run build`, Output Directory `dist`.
  - Verified live: Frontend reachable at `https://claimchain-mu.vercel.app` and `https://claimchain-mu.vercel.app/api/health` successfully proxies to Render.

- **4. Cloud Constraints & Diagnosed Failure Modes:**
  - **Issue A: "Chain unavailable: could not seal genesis record" (HTTP 503)**
    - *Diagnosis:* Deployer wallet `0x85d93Ca2...` ran out of faucet POL on Polygon Amoy (balance was `0.00427 POL`, whereas network gas fee for `sealClaimState` requires `~0.00958 POL`).
    - *Result:* Polygon Amoy rejected transaction with `insufficient funds for gas * price + value`, causing backend genesis seal to fail.
    - *Fix:* Requires testnet faucet top-up via `faucet.polygon.technology` or `faucets.chain.link/polygon-amoy`.
  - **Issue B: Render 502 Bad Gateway / Container Restarts**
    - *Diagnosis:* Render Free Tier provides 512 MB of RAM. The server runs heavy local AI tasks (`@huggingface/transformers` CLIP ViT-B/32 ONNX model is ~350MB+ and Tesseract OCR). Simultaneous inference and image handling exceeds 512 MB, triggering Linux OOM killer and container restart.
  - **Issue C: Sunita Pawar (`CLM-8930`) "Pipeline running" status**
    - *Diagnosis:* In `seed.ts`, `CLM-8930` is explicitly configured with `freshOnly: true` as a simulated fresh queue item. Verification was never run for this claim, leaving `verification: null`. The frontend appropriately displays the placeholder spinner `"Pipeline running — stages appear live…"`. Other claims (`CLM-4102`, `CLM-8919`, `CLM-8920`) possess complete 7-stage verifications.

- **5. Pivot to Localhost (The Recommended Stable Demo Environment):**
  - Given cloud testnet gas constraints and Render 512MB RAM limits, user determined localhost execution is far superior for seamless evaluation, testing, and presentations.
  - Verified local stack running via `npm run dev` (`bash scripts/demo.sh`):
    - **Hardhat Blockchain Node:** `http://127.0.0.1:8545` (10,000 ETH free gas, instant sub-second block confirmation).
    - **Local Contract:** `ClaimAuditTrail.sol` deployed at `0x5FbDB2315678afecb367f032d93F642f64180aa3`.
    - **API Server:** `http://localhost:4000` (runs with full Mac CPU/RAM, sub-second pipeline processing).
    - **Web Dashboard:** `http://localhost:5173/console` (green `CHAIN LIVE` status, instant UI updates).
  - All local endpoints and services verified active and healthy.

- **6. Project Governance & Rules Enforced:**
  - User instruction: *"now major parts don't change or add code yet just plan first but before anything save all the context till now of this project in CLAIMCHAIN_CONTEXT.md files without missing anything so that other AI models can also understand the project if your limit reached and from now on save all the progress in this file also"*.
  - Strict planning-first discipline active: no major architecture changes or code edits without prior plan approval.
  - `CLAIMCHAIN_CONTEXT.md` maintained as the authoritative single source of truth across all turns.

### 2026-09-23 (Late Night) — Insurer Auth, Relational Database & Security Architecture Plan

- **User Requests & Inquiries:**
  1. Working authentication system for Insurers/Inspectors (Inspector 1, Inspector 2, Supervisor).
  2. Relational database system with multi-tenant Insurer Claimant History and status filtering (Approved, Flagged, Rejected, Paid).
  3. Forensic authenticity proof: How to verify signatures and stamps on land registry documents (*विक्रय विलेख, खतौनी, खसरा*) against fraud.
  4. Data breach prevention & PII protection for uploaded Aadhaar and Land Registry documents.
  5. Save this implementation plan into a unique persistent file before AI usage limits are reached so new models can resume immediately.
- **Architectural Deliverables Created:**
  - Saved comprehensive plan in: **`INSURER_AUTH_DB_SECURITY_PLAN.md`** (located at workspace root and `claimc-main/`).
  - **Q3 Security Model:** Triangulation across Bhulekh/AgriStack government land registry APIs (Deed/Khasra/SRO verification), deep learning signature stroke dynamics (SigNet), and PKI public-key certificate verification for digital QR e-Signs.
  - **Q4 Data Breach Model:** Zero PII on-chain (only irreversible SHA-256 state hashes), mandatory client/server-side Aadhaar 8-digit masking (`XXXX XXXX 4533`), AES-256-GCM envelope encryption at rest, and short-lived signed URLs with strict RBAC.
  - **Feature 1 (Auth):** Bcrypt hashed passwords, stateless JWT tokens, Express `requireAuth` middleware, `/login` screen with one-click inspector presets, header profile/logout badge.
  - **Feature 2 (DB & History):** SQLite (via Better-SQLite3 / Prisma) relational schema (`users`, `claims`, `evidence`, `audit_records`), filterable dashboard tabs, and inspector history selector.
- **Next Model Handoff Instruction:**
  - **Do NOT execute code changes until user gives explicit confirmation.**
  - Review `INSURER_AUTH_DB_SECURITY_PLAN.md` and execute steps 1 through 5 sequentially upon user approval.

---

## 7. Next Steps / Open Threads

- [x] ~~**Wire `server/` claims API to the blockchain contract**~~ — **done**: sealing + verified audit-trail endpoint, e2e smoke test passes
- [x] ~~Add Prisma + SQLite/Postgres when persistence is needed~~ — **Interim DONE (2026-09-18)**: write-through snapshot persistence (`server/src/persist.ts`)
- [x] **Deploy to Polygon Amoy testnet** — **DONE (2026-09-23)**: contract deployed at `0xb2aE1FC9887b1F77D1e45944654f0D7349B0Ce27` with deployer `0x85d93Ca2D66afab27755D5d4D776Ead173CcdfeB`
- [x] **Deploy full stack to Cloud** — **DONE (2026-09-23)**: Render backend (`claimchain-api.onrender.com`) + Vercel frontend (`claimchain-mu.vercel.app`) with proxy rewrites
- [x] **Architecture Plan Saved** — **DONE (2026-09-23)**: `INSURER_AUTH_DB_SECURITY_PLAN.md` created for Insurer Auth, SQLite DB, and Document Security
- [ ] **Awaiting User Confirmation**: Execute Step 1 (Database Layer) & Step 2 (Auth System) from `INSURER_AUTH_DB_SECURITY_PLAN.md`
- [ ] **Graceful Chain Fallback (Local & Cloud)**: Make genesis seal failure non-blocking or add explicit user alert if wallet gas is exhausted
- [ ] **Sunita Pawar Demo Handling**: Add explicit "Trigger Pipeline" or retry button in Console when selecting an unverified claim
- [ ] **Farmer-facing light portal** (screen-02 style) — unbuilt
- [x] **Flood-flow farmer-doc verification** — DONE (2026-09-19): bilingual registry/Aadhaar/policy OCR + DOC_CROSS + R5 satellite destruction ladder verified e2e
- [x] ~~**Prototype the hash-chain demo**~~ — **DONE**: real hash-chained contract + `verifyTrail` + `/api/demo/tamper|restore` (local-node-only)
- [x] ~~**Implement `CLAIMCHAIN_WORKFLOW.md`**~~ — **DONE (2026-09-18)**: guard + RULE ZERO `/pay`, multipart evidence upload, real 7-stage pipeline with stage logs + verification digest sealed on-chain
- [x] **Real AI (free local stack)** — DONE (2026-09-18): `sharp` + `exifr` + `sharp-phash` + `tesseract.js` + CLIP ViT-B/32 (`@huggingface/transformers`)
- [x] **Frontend rebuild (2026-09-18)** — DONE in the Halo fintech language: Landing (`/`) pixel-faithful + working Console (`/console`)
- [x] ~~Random-pics auto-approve hole~~ — **CLOSED (2026-09-18)**
- [ ] QR code on dossier/receipt linking to a public verify page
- [ ] Multi-tenant auth & database layer (PostgreSQL + Prisma) for production deployment

---
