# Training set — drop your labeled samples here

This folder is where `npm run train:folder` (in `server/`) looks for labeled
fraud/genuine examples. Structure:

```
training-set/
├── genuine/
│   ├── claim-001/          ← one folder = one case (grouped!)
│   │   ├── field-1.jpg
│   │   └── bill.jpg
│   └── claim-002/  …
└── fraud/
    ├── case-001/           ← e.g. photoshopped flood photo
    │   ├── fake.jpg
    │   ├── original.jpg    ← if you have the source, include it too
    │   └── manifest.json   ← optional: {"lossType":"flood","district":"nanded","note":"..."}
    └── case-002/  ai-generated-scene.jpg
```

Rules of thumb:

- **One folder = one case/claim.** The memory enrolls per group; re-running
  with the same folder names UPSERTS (never duplicates).
- Loose image files directly inside `genuine/` or `fraud/` form a shared
  `_flat` group — prefer proper folders.
- Optional `manifest.json` per group: `{"lossType":"flood","district":"nanded","note":"what makes this fake"}`
  (displayed during training; provenance for auditors).
- JPG / PNG / WEBP, any size (CLIP resizes to 224×224).

Run it:

```bash
cd server
npm run train:folder -- ../training-set
```

Then check the dashboard's Memory page (or `GET /api/fraud-memory`) — the new
embeddings appear immediately and start voting in the k-NN on the next claim.

Calibrate thresholds against your real samples before/after:

```bash
npm run calibrate -- ../training-set/fraud/case-001/fake.jpg
```
