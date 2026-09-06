# NoteProject Engineering Guide

## Current Baseline

- Active v2 branch: `feature/review-effect-coach-v2`.
- Product boundary: `docs/新的方案.md`.
- Database version: schema 17. Store definitions live in `src/db/reviewCoachSchema.ts`.
- Stages 0-3 were completed and verified on 2026-09-06. Stage 4 is the next allowed scope.

## Review Coach Boundaries

- `RecordBlock.contentHtml` is the only editable source of decision-block content. `DecisionBlock` is an index, not a second content copy.
- Formal review-coach writes go through `src/features/reviewCoach/repository.ts`; cross-entity workflows belong in `orchestrator.ts`, not `useAppData.ts`.
- Projections must be rebuildable from formal facts. AI responses and local execution caches are not truth sources.
- Record-level FSRS remains responsible for whole-record scheduling. Decision-block facts must not silently rewrite FSRS state.
- Stage 3 added block feedback, immutable history, tombstones, queue enrollment, exclusion/restoration, analysis notes, and manual legacy-comment association.
- Stage 3 must not call AI, implement `FeedbackInterpretation`, generate `SessionBlueprint`, schedule adaptive tasks, or begin stages 4-9.

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

Use deterministic mocks in automated tests. Real AI providers are reserved for the controlled acceptance stage defined in the product plan.
