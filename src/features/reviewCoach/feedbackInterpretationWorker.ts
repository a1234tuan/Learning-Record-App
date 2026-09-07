import type { FeedbackInterpretation } from "./domain";
import type { InterpretFeedbackInput, ReviewCoachOrchestrator } from "./orchestrator";

const activeJobs = new Map<string, Promise<FeedbackInterpretation>>();

/**
 * Deduplicates in-flight work in this app instance. Formal state remains in
 * Dexie, so a restarted app can safely retry pending or failed interpretations.
 */
export const processFeedbackInterpretation = (
  orchestrator: ReviewCoachOrchestrator,
  input: InterpretFeedbackInput,
): Promise<FeedbackInterpretation> => {
  const existing = activeJobs.get(input.feedbackId);
  if (existing) return existing;
  const job = orchestrator.interpretFeedback(input).finally(() => {
    if (activeJobs.get(input.feedbackId) === job) activeJobs.delete(input.feedbackId);
  });
  activeJobs.set(input.feedbackId, job);
  return job;
};

export const processFeedbackInterpretationQueue = async (
  orchestrator: ReviewCoachOrchestrator,
  jobs: readonly InterpretFeedbackInput[],
  options: { maxConcurrency?: number } = {},
): Promise<FeedbackInterpretation[]> => {
  const maxConcurrency = Math.max(1, Math.floor(options.maxConcurrency ?? 1));
  const results: FeedbackInterpretation[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const index = cursor;
      cursor += 1;
      if (jobs[index].signal?.aborted) break;
      results[index] = await processFeedbackInterpretation(orchestrator, jobs[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(maxConcurrency, jobs.length) }, worker));
  return results;
};
