import { describe, expect, it } from "vitest";

import {
  REVIEW_COACH_AI_CONTRACTS,
  parseFeedbackInterpretationAiResponse,
} from "./aiSchemas";

describe("review coach AI contracts", () => {
  it("pins prompt, policy, and JSON schema versions for every AI role", () => {
    for (const contract of Object.values(REVIEW_COACH_AI_CONTRACTS)) {
      expect(contract.promptVersion).toMatch(/-v1$/);
      expect(contract.policyVersion).toBe("review-coach-policy-v1");
      expect(contract.schemaVersion).toBe(1);
      expect(contract.schema).toHaveProperty("oneOf");
      expect(JSON.stringify(contract.schema)).toContain("insufficient-context");
    }
  });

  it("accepts an explicit insufficient-context result", () => {
    expect(parseFeedbackInterpretationAiResponse({
      status: "insufficient-context",
      missingInformation: ["missing OCR"],
    })).toEqual({ status: "insufficient-context", missingInformation: ["missing OCR"] });
  });

  it("rejects invented or malformed interpretation output", () => {
    expect(() => parseFeedbackInterpretationAiResponse({
      status: "ok",
      actionability: "do-anything",
      difficultyType: "concept",
      stuckAt: null,
      userHypothesis: null,
      preferredPractice: null,
      missingInformation: [],
      confidence: 2,
    })).toThrow();
  });
});
