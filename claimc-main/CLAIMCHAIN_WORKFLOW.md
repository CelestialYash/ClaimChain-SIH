# ClaimChain — Intended Workflow (Source of Truth)

> **Status:** SPEC ONLY — no code has been changed yet. This file defines *what the workflow
> must be* so the next implementation round has a clear target.
>
> **Problem with the current prototype (2026-09-18):** the Command Center's buttons call
> `POST /api/claims/:id/transitions` with a *caller-chosen* status (`AI_APPROVED`, `AI_FLAGGED`,
> `PAID`…). There is no document/photo upload, no AI verification, no evidence, and **no guard —
> a flagged claim can be paid instantly**. The buttons "decide" nothing. This spec fixes that.

---

## 0. Design principles

1. **Nobody types a verdict.** AI verdicts are *computed* by the verification pipeline; humans can
   only review/override *flagged* claims. `PAID` is a consequence of state, never a free choice.
2. **No evidence, no claim.** A claim without ≥1 photo/document cannot be created or verified.
3. **Every step leaves a sealed log.** Each pipeline stage emits a log entry that is hashed into the
   claim's state and sealed on-chain — the AI must *show its work*.
4. **Flag = freeze.** A flagged claim enters a review lane; payout is impossible until a human
   resolves it. No exceptions, no demo bypasses on this rule.
5. **Verdicts are deterministic.** Same evidence in → same verdict out. Any retro-edit of evidence
   or verdict breaks the hash chain — tamper detection is the alarm, not the defense.

---

## 1. Stage 1 — Intake: document & photo upload

**User story:** the claimant (or the ops agent acting for them) adds evidence **at claim creation**,
not after.

### 1.1 What can be uploaded
| Type | Formats | Limits | Extracted from |
|------|---------|--------|----------------|
| Damage photos | JPG, PNG, HEIC | ≤ 10 MB each, 1–6 images | EXIF (timestamp, GPS, device), pHash, dimensions |
| Bills / receipts | JPG, PNG, PDF | ≤ 10 MB, 0–3 files | OCR text, totals, dates |
| ID / policy document | JPG, PNG, PDF | ≤ 10 MB, 0–2 files | OCR of policy no., name |

### 1.2 New/changed API contract
```
POST /api/claims                 → multipart/form-data (NOT JSON anymore)
  fields: claimantName, lossType, amountRequested, note?
  files:  photos[] (required ≥1), documents[] (optional)
  → server immediately: virus/size/type check → store bytes (disk or object store)
  → compute per file: sha256, pHash (64-bit), exif {gps?, takenAt, device?}
  → evidence rows created with status = PENDING_VERIFICATION
  → genesis seal on-chain includes evidence hashes in stateHash (already does via imageHashes
    — extend to all file hashes + exif digests)
  → response: { claim, evidence: [...], verificationJobId }
```

```
POST /api/claims/:id/evidence            → add late evidence (creates a sealed ADDENDUM record)
GET  /api/claims/:id/evidence            → list evidence + per-file verification results
GET  /api/evidence/:fileId               → serve original bytes (auth-gated)
```

**Rules**
- Upload happens **before** any verification; `claim.status = SUBMITTED` only after ≥1 valid photo.
- `imageHashes` in the on-chain state hash becomes `evidenceHashes[]` (sha256) + `pHashes[]`.
- Everything a user uploads is immutable once submitted: changing it = new ADDENDUM record, never
  an edit.

---

## 2. Stage 2 — AI verification pipeline (runs automatically)

**Trigger:** immediately after creation (async job), plus re-run on late evidence.
**No button.** The UI shows progress; there is nothing to click.

### 2.1 Pipeline stages (each emits a log)
| # | Stage | What it does | Emits (log fields) |
|---|-------|--------------|--------------------|
| 1 | `EXIF_INTEGRITY` | Parse EXIF; flag missing GPS/timestamp, editing-software tags, timestamp vs submission skew | stage, pass/fail, details |
| 2 | `DUPLICATE_PHASH` | Hamming-distance compare pHash against every stored photo (all claims) → reuse/repost detection | pass/fail, collisions [{claimId, distance}] |
| 3 | `OCR_EXTRACT` | Tesseract (or vision API) on bills/ID → policy no., name, amount, dates | fields found, confidence per field |
| 4 | `POLICY_MATCH` | OCR fields vs claim metadata + in-memory policy table: name match, amount ≤ policy limit, loss date within cover window | pass/fail, mismatches |
| 5 | `DAMAGE_ASSESS` | CV heuristic (v1: brightness/edge/region stats + loss-type rules; v2: real model) → damage present? severity score 0–100 | score, thresholds used |
| 6 | `FRAUD_RULES` | Deterministic rule engine over all prior signals: duplicate evidence, GPS/district mismatch with loss type, amount outliers, multiple claims same evidence, severity-vs-amount inconsistency | rule id, verdict per rule |
| 7 | `DECISION` | Weighted score → verdict by **thresholds**, not vibes | score, verdict, reasons[] |

### 2.2 Verdict rules (deterministic)
- `AI_APPROVED` — all stages pass AND fraud score < LOW_THRESHOLD.
- `AI_FLAGGED` — any hard-fail (duplicate pHash, policy mismatch, EXIF edit-tag) OR score in the
  grey zone. **A flagged claim is locked for payout until a human decides.**
- `AI_REJECTED` — score below reject threshold or evidence proves no insurable event.

### 2.3 New/changed API contract
```
GET /api/claims/:id/verification            → job status + full stage-by-stage log + final verdict
POST /api/claims/:id/verification/retry     → staff-only re-run (seals a RETRY record, keeps history)
```

### 2.4 "Act like AI" fallback (demo realism without a real model)
The pipeline is **real code** with pluggable engines:
- pHash + EXIF + sha256 + OCR(via Tesseract) + policy/rules engine = **real and deterministic**.
- Damage assessment v1 = deterministic CV heuristics (real math, explainable).
- So the demo is not "fake AI" — it's a **real rule-based verifier**; swapping in an ML model later
  only replaces stage 5's engine.
- Every stage takes measurable wall-clock time (logs show durations) so the UI can show a genuine
  progress pipeline instead of an animation.

---

## 3. Stage 3 — Verification logs (the "result logs" view)

Each verification run produces an ordered, hash-linked log:

```json
{
  "verificationId": "ver_...",
  "claimId": "CLM-XXXX",
  "startedAt": "...", "finishedAt": "...", "durationMs": 8432,
  "verdict": "AI_FLAGGED",
  "score": 62,
  "stages": [
    { "stage": "EXIF_INTEGRITY",   "result": "PASS", "details": "GPS present (19.03N, 73.01E)", "ms": 120 },
    { "stage": "DUPLICATE_PHASH",  "result": "FAIL", "details": "pHash collision: CLM-8919 img#2, Hamming distance 2", "ms": 880 },
    { "stage": "OCR_EXTRACT",      "result": "PASS", "details": "policy MH-12-9931 · ₹4,500 · confidence 0.97", "ms": 4100 },
    { "stage": "POLICY_MATCH",     "result": "PASS", "details": "name/amount/date within cover", "ms": 60 },
    { "stage": "DAMAGE_ASSESS",    "result": "PASS", "details": "severity 71/100 (flood)", "ms": 1900 },
    { "stage": "FRAUD_RULES",      "result": "FAIL", "details": "R2 duplicate-evidence across districts", "ms": 40 },
    { "stage": "DECISION",         "result": "AI_FLAGGED", "details": "score 62 ≥ flag threshold 50; reasons: R2, pHash-collision", "ms": 12 }
  ]
}
```

- Log entries are part of the claim state: the DECISION record's `stateHash` commits
  `verificationId + verdict + score + per-stage result hashes` on-chain.
- UI (later, when frontend is rebuilt): pipeline stepper + expandable stage log; this data powers
  the existing "Forensic Evidence Inspection" narrative.

---

## 4. Stage 4 — Decision & the state machine (the guard the prototype lacks)

### 4.1 Allowed transitions — enforced **server-side**
```
SUBMITTED      ──(auto: pipeline)──▶  AI_APPROVED | AI_FLAGGED | AI_REJECTED
AI_APPROVED    ──(auto/disbursement)▶  PAID
AI_FLAGGED     ──(human review)────▶  HUMAN_APPROVED (payout-unlocked) | HUMAN_REJECTED
AI_REJECTED    ──(human appeal)────▶  HUMAN_REVIEW (optional second look)
HUMAN_APPROVED ────────────────────▶  PAID
PAID / HUMAN_REJECTED               →  terminal
```

### 4.2 Hard rules (each enforced in `POST /transitions` and any new endpoint)

> **⭐ RULE ZERO — FLAGGED CLAIMS CANNOT BE PAID UNTIL A HUMAN APPROVES THEM.**
> `AI_FLAGGED` is a payout freeze. The only exit is a human review decision:
> `HUMAN_APPROVED` (unlocks payment; requires a ≥20-char reason, sealed on-chain) or
> `HUMAN_REJECTED` (terminal). Any attempt to pay a claim in `AI_FLAGGED` state returns
> **HTTP 409 FLAGGED_LOCKED** — this includes `/transitions`, `/pay`, and any future endpoint.
> There is no bypass, no demo shortcut, no client-side override of this rule.

1. **No client-chosen AI verdicts.** `AI_APPROVED` / `AI_FLAGGED` / `AI_REJECTED` statuses are set
   *only* by the pipeline. The old direct "AI Approve / AI Flag" transition path is removed.
2. **Flag = payout lock.** `PAID` is rejected with HTTP 409 unless current status is
   `AI_APPROVED` or `HUMAN_APPROVED`. This is the single most important missing guard.
3. **Human override requires:** status `AI_FLAGGED` (or `AI_REJECTED`), a note ≥ 20 chars explaining
   why, and (spec-ready) an authenticated reviewer identity — sealed as `HUMAN_APPROVED` /
   `HUMAN_REJECTED` / `HUMAN_REVIEW`, never as a fabricated AI status.
4. **Terminal states reject all transitions** (except the documented appeal path).
5. Every accepted transition still seals on-chain (unchanged behavior), and the sealed note for AI
   verdicts is the pipeline's decision log, not a free-text string.

### 4.3 Frontend impact (for when we rebuild it)
- "AI Approve / AI Flag" buttons disappear. Intake screen gains upload. Claim detail gains a
  **verification pipeline panel** (live logs) and, for flagged claims, a **review panel** with a
  mandatory reason field. "Pay" only renders for unlocked claims — and the server rejects it anyway.

---

## 5. Stage 5 — Tamper rules (retro-edit / evidence edits)

**Already real:** hash-chained records + `verifyTrail` + `findChainBreak` + tamper/restore demo.
What the spec *adds*:

1. **Evidence immutability:** uploaded files are content-addressed by sha256. Overwriting or
   replacing bytes = new ADDENDUM record; the old record keeps proving what was originally claimed.
   If a re-verified file's hash ≠ its sealed hash → `EVIDENCE_TAMPERED` alert record + claim auto-
   flags (same freeze as §4.2.2).
2. **Verification log tamper-proofing:** each stage result hash is committed in the DECISION state
   hash; re-running verification never mutates history (RETRY appends).
3. **UI copy change (later):** "Attempt Retro-Edit" stays as the *intentional* demo, but the API
   responses must always surface `integrity.valid === false` and the break index — the UI must never
   allow editing live claim fields (the only sanctioned write path is a new sealed transition).
4. **Restore** remains a local-node-only, `assertLocalRpc`-guarded demo operation. Never on real RPC.

---

## 6. Payment flow (only lawful path)

```
AI_APPROVED ──▶ POST /api/claims/:id/pay { upiRef } ──▶ validates status
             ──▶ seals PAID with note = upiRef + amount
             ──▶ claim PAID (terminal)
AI_FLAGGED  ──▶ 409 FLAGGED_LOCKED { reason: "human review required" }
```
- Payout payload (UPI ref, amount) is hashed into the PAID record.
- `/api/stats` keeps its KPIs; add `flaggedLocked` count (claims blocked from payout) as a headline
  metric for judges.

---

## 7. Endpoint summary (delta vs. today)

| Endpoint | Today | Spec |
|----------|-------|------|
| `POST /api/claims` | JSON, hashes optional, no files | multipart, files required, evidence rows + sealed hashes |
| `POST /api/claims/:id/transitions` | any status by anyone | restricted (§4.2); AI statuses pipeline-only |
| `POST /api/claims/:id/pay` | — (abused `/transitions`) | new, guarded payout endpoint |
| `GET /api/claims/:id/verification` | — | pipeline status + stage logs + verdict |
| `POST /api/claims/:id/verification/retry` | — | staff re-run, appends RETRY record |
| `POST /api/claims/:id/evidence` | — | late evidence → ADDENDUM, re-verify |
| `GET /api/evidence/:fileId` | — | auth-gated byte serving |
| `POST /api/demo/tamper|restore` | exists | unchanged (local-only) |
| `GET /api/stats` | exists | + `flaggedLocked`, `verificationDurationP50Ms` |

**Status enum delta:** add `HUMAN_APPROVED`, `HUMAN_REJECTED`, `HUMAN_REVIEW` (contract currently
supports 6 statuses; extend `CLAIM_STATUS` map + contract enum or reuse `HUMAN_OVERRIDDEN` with the
note distinguishing approve/reject — decide at implementation time; extending the enum is cleaner).

---

## 8. Implementation order (when we say go)

1. **Server guard** (small, huge win): transition whitelist + flag-lock on payout + `/pay` endpoint.
2. **Evidence upload:** multipart parsing, storage, sha256/pHash/EXIF, evidence rows + ADDENDUM.
3. **Pipeline engine:** stages 1–7 as pure functions over evidence + claim, with the log format §3.
4. **Wire pipeline to claim creation** (async job), remove client-chosen AI transitions.
5. **Seal verification summary** in the DECISION record's state hash; extend dossier/Merkle to
   include it.
6. **(Optional)** Tesseract OCR engine + real CV heuristics; pluggable behind an interface.
7. **Frontend rebuild later** (user-driven): intake upload, pipeline stepper, review panel — no
   frontend work in this round.

## 9. Non-goals for this round
- No persistence (still in-memory), no auth/identity beyond spec notes, no real ML model (rule-based
  verifier instead), no contract redeployment needed unless the enum is extended.
