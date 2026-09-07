import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendChatCompletionDetailed } from "../../services/aiClientService";
import { createQuizExecutionGateway } from "./quizExecutionGateway";

vi.mock("../../services/aiClientService", () => ({ sendChatCompletionDetailed: vi.fn() }));

const provider = { id: "deep", providerName: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", temperature: 0, maxTokens: 8000 };
const evidence = [{ decisionBlockId: "block-1", recordId: "record-1", contentVersion: 1, excerptHash: "hash-1", purpose: "source" }];

describe("quiz execution gateway", () => {
  beforeEach(() => vi.mocked(sendChatCompletionDetailed).mockReset());

  it("requests structured JSON and parses a quiz turn", async () => {
    vi.mocked(sendChatCompletionDetailed).mockResolvedValue({ content: JSON.stringify({ status: "ok", practiceType: "variation", answerMode: "unique", question: "Choose the correct boundary.", answerCriteria: ["right inclusive"], sourceEvidence: evidence, hints: ["Check the invariant."] }), requestId: "turn-1", usage: { totalTokens: 120 } });
    const gateway = createQuizExecutionGateway({ provider, apiKey: "secret" });
    const result = await gateway.generateTurn({ blueprint: {}, decisionBlockContent: "source" });
    expect(result).toMatchObject({ status: "ok", answerMode: "unique" });
    const request = vi.mocked(sendChatCompletionDetailed).mock.calls[0][0];
    expect(request.request).toMatchObject({ structuredOutput: true, thinkingMode: "disabled" });
    expect(request.prompt).toContain('"answerCriteria":["..."]');
    expect(request.prompt).toContain("input.blueprint.evidence 原样复制");
  });

  it("rejects malformed quality output", async () => {
    vi.mocked(sendChatCompletionDetailed).mockResolvedValue({ content: JSON.stringify({ status: "ok", verdict: "pass", severeIssues: ["invented"], rationale: "no" }) });
    const gateway = createQuizExecutionGateway({ provider, apiKey: "secret" });
    await expect(gateway.reviewQuestion({ candidate: {} })).rejects.toThrow();
  });
});
