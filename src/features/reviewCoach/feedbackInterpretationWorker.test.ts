import { describe, expect, it, vi } from "vitest";

import type { FeedbackInterpretation } from "./domain";
import type { InterpretFeedbackInput, ReviewCoachOrchestrator } from "./orchestrator";
import { processFeedbackInterpretation, processFeedbackInterpretationQueue } from "./feedbackInterpretationWorker";

const input = (feedbackId: string, signal?: AbortSignal): InterpretFeedbackInput => ({
  feedbackId,
  decisionBlockContent: "content",
  provider: "test",
  model: "fast",
  promptVersion: "p",
  policyVersion: "policy",
  schemaVersion: 1,
  signal,
});

const result = (feedbackId: string): FeedbackInterpretation => ({
  id: `interpretation-${feedbackId}`,
  feedbackId,
  decisionBlockId: "block-1",
  contentVersion: 1,
  status: "succeeded",
  missingInformation: [],
  aiGenerated: true,
  model: "fast",
  provider: "test",
  promptVersion: "p",
  policyVersion: "policy",
  schemaVersion: 1,
  createdAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:00:00.000Z",
});

describe("feedback interpretation worker", () => {
  it("deduplicates concurrent work for the same feedback", async () => {
    let resolve!: (value: FeedbackInterpretation) => void;
    const pending = new Promise<FeedbackInterpretation>((done) => { resolve = done; });
    const interpretFeedback = vi.fn(() => pending);
    const orchestrator = { interpretFeedback } as unknown as ReviewCoachOrchestrator;

    const first = processFeedbackInterpretation(orchestrator, input("feedback-1"));
    const second = processFeedbackInterpretation(orchestrator, input("feedback-1"));
    expect(second).toBe(first);
    expect(interpretFeedback).toHaveBeenCalledTimes(1);
    resolve(result("feedback-1"));
    await expect(first).resolves.toMatchObject({ feedbackId: "feedback-1" });
  });

  it("does not take another queued job after the runtime is aborted", async () => {
    const controller = new AbortController();
    const interpretFeedback = vi.fn(async (job: InterpretFeedbackInput) => {
      controller.abort();
      return result(job.feedbackId);
    });
    const orchestrator = { interpretFeedback } as unknown as ReviewCoachOrchestrator;

    const results = await processFeedbackInterpretationQueue(orchestrator, [input("feedback-1", controller.signal), input("feedback-2", controller.signal)]);
    expect(results).toHaveLength(1);
    expect(interpretFeedback).toHaveBeenCalledTimes(1);
  });
});
