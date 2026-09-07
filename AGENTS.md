# NoteProject Engineering Guide

## Current Baseline

- Active v2 branch: `feature/review-effect-coach-v2`.
- Product boundary: `docs/新的方案.md`.
- Database version: schema 18. Store definitions live in `src/db/reviewCoachSchema.ts`; schema 18 removes the unique `AdaptiveReviewTask.blueprintId` index so an accepted Blueprint can be reused by its delayed-verification task.
- Stages 0-7 were completed and verified on 2026-09-07. Stages 8-9 remain out of scope.

## Review Coach Boundaries

- `RecordBlock.contentHtml` is the only editable source of decision-block content. `DecisionBlock` is an index, not a second content copy.
- Formal review-coach writes go through `src/features/reviewCoach/repository.ts`; cross-entity workflows belong in `orchestrator.ts`, not `useAppData.ts`.
- Projections must be rebuildable from formal facts. AI responses and local execution caches are not truth sources.
- Record-level FSRS remains responsible for whole-record scheduling. Decision-block facts must not silently rewrite FSRS state.
- Stage 3 added block feedback, immutable history, tombstones, queue enrollment, exclusion/restoration, analysis notes, and manual legacy-comment association.
- Stage 4 calls only the quick feedback interpreter and preserves original feedback.
- Stage 5 adds the manually confirmed deep-analysis workbench, validated `SessionBlueprint` creation, and deterministic current/waiting/deferred task scheduling.
- Stage 6 adds the dedicated adaptive review page, Blueprint-constrained turn generation, independent question quality review, answer evaluation, hint/skip/invalid/defer/abandon dispositions, and atomic answer/outcome commits.
- Stage 7 schedules delayed verification through deterministic local policy, requires fresh retrieval questions, records retained/decayed outcomes independently from record FSRS, rebuilds block/effect projections from formal facts, and applies aging plus a two-verification streak cap to task selection.
- Stage 6 quick-model calls use strict JSON and explicitly disable thinking. Controlled real-provider acceptance may use `https://api.deepseek.com` with `deepseek-v4-flash`; never persist API keys in source, tests, docs, logs, screenshots, backup, or sync data.

## Cross-Cutting Checks

When changing decision-block or review-coach behavior, verify all affected paths:

- Dexie migration and repository invariants
- backup/restore and record-transfer round trips
- cloud-sync entity mapping and tombstones
- record deletion and mixed-record cleanup
- Desktop and Android narrow-screen interaction

## Verification

```powershell
npm run test
npm run build
git diff --check
```

Use deterministic mocks in automated tests. Real AI providers are limited to explicit, controlled acceptance runs and must never replace deterministic CI coverage.

For local Stage 3 UI acceptance, run `npm run build`, start `npm run preview -- --host 127.0.0.1 --port 4177`, and open `http://127.0.0.1:4177/?preview=stage3`. This localhost-only query seeds an isolated `BFS Stage3 Preview` record with an overdue review, block feedback, and an analysis-queue item; it is gated out of normal URLs and native shells.

For Stage 4 UI acceptance, use `http://127.0.0.1:4177/?preview=stage4`. It adds a deterministic completed quick-model interpretation with diagnostics and confirmation controls without contacting an AI provider.

For Stage 5 UI acceptance, use `http://127.0.0.1:4177/?preview=stage5`. It seeds deterministic eligible blocks, an OCR warning, a partial analysis result, and current/waiting/deferred tasks without contacting an AI provider.

For Stage 6 UI acceptance, use `http://127.0.0.1:4177/?preview=stage6`. It seeds a deterministic in-progress task with one displayed, quality-checked turn; hints, answer submission, skip, invalid-question reporting, defer, and abandon controls can be exercised without contacting an AI provider.

For Stage 7 UI acceptance, use `http://127.0.0.1:4177/?preview=stage7`. It seeds one in-progress delayed verification plus retained and decayed history, then rebuilds block and intervention-effect projections without contacting an AI provider.
