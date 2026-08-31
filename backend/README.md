# PASSCOGH-MODOO — Matched Backend

This backend is a surgical backend layer for the existing PASSCOGH-MODOO project. It does NOT replace the existing frontend or curriculum.

## Keep these existing project parts
- `public/index.html` — keep the frontend you already approved.
- `data/passcogh_curriculum.json` — keep the latest curriculum.
- `data/diagrams/` — keep the existing 1,356 diagrams.
- Existing repository folders and assets — keep them.

## What this backend matches
- Curriculum: 9 levels / 114 subjects / 1,356 topics.
- Topic lesson fields are served as stored; no sample curriculum is substituted.
- Diagram routing uses the existing filename pattern (`level__subject-code__topic-number__slug`) and also has fallback scoring.
- JHS/SHS topic PDF download price: GHS 1.
- Pre-University guidance check: GHS 5.
- Courses and Skills Path: GHS 20 each.
- Online reading: free; reading ad interval reported as 5 minutes.
- Creator account: unlimited/free access and ads disabled.
- Genuine WASSCE 2012–2026 papers remain unavailable until authorization/legal source is confirmed.
- 2027 material is exposed only as original PASSCOGH-MODOO prediction practice.
- Render uses `PORT` and `0.0.0.0`.
- PostgreSQL is used when `DATABASE_URL` is configured; memory mode is only a development fallback.

## Placement
If your repository has `backend/server.js`, replace ONLY that file with this `server.js` first. Do not replace `public/index.html` or `data/`.

The server automatically looks for `data/passcogh_curriculum.json`, `data/diagrams/`, and `public/` in either the backend folder or repository root, so the existing repository structure is preserved.

## Render
Recommended start command when Render's Root Directory is the repository root:
`node backend/server.js`

If Render's Root Directory is already `backend`, use:
`node server.js`

Do not create a second frontend or duplicate curriculum file.

## Required production environment variables
- `DATABASE_URL`
- `JWT_SECRET`
- `CREATOR_EMAIL`
- `PUBLIC_BASE_URL`
- `PAYSTACK_SECRET_KEY` (when payments are activated)

Payment credentials must be real production/test credentials from the chosen provider; the code does not fake successful payments.
