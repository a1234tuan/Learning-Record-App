import type { AiProviderConfig, KnowledgePoint, KnowledgeRelationProposal, LearningCoachSnapshot, LearningCoachTaskCandidate, LearningCoachDiagnosis } from "../types";
import { getCurrentAiProvider } from "../lib/aiProviders";
import { canonicalStudySubject } from "../lib/subjects";
import { sendChatCompletionDetailed } from "./aiClientService";
import { storage } from "./storageAdapter";

const parseCandidates = (value: unknown): LearningCoachTaskCandidate[] => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const kind = raw.kind;
    if ((kind !== "review" && kind !== "revisit-record" && kind !== "practice") || typeof raw.title !== "string") return [];
    const subject = typeof raw.subject === "string" && raw.subject.trim() ? canonicalStudySubject(raw.subject) : undefined;
    const actionType = raw.actionType === "review-queue" || raw.actionType === "ai-quiz" || raw.actionType === "create-record" ? raw.actionType : undefined;
    return [{
      kind,
      title: raw.title.trim(),
      subject,
      recordIds: Array.isArray(raw.recordIds) ? raw.recordIds.filter((id): id is string => typeof id === "string") : [],
      reason: typeof raw.reason === "string" ? raw.reason : "AI 建议",
      actionLabel: typeof raw.actionLabel === "string" && raw.actionLabel.trim() ? raw.actionLabel.trim() : "开始练习",
      issueKey: typeof raw.issueKey === "string" ? raw.issueKey : undefined,
      action: actionType ? { type: actionType, subject, recordIds: Array.isArray(raw.recordIds) ? raw.recordIds.filter((id): id is string => typeof id === "string") : [] } : undefined,
    }];
  });
};

const parseRelationProposals = (value: unknown, points: KnowledgePoint[], diagnoses: LearningCoachDiagnosis[] = []): KnowledgeRelationProposal[] => {
  if (!Array.isArray(value)) return [];
  const pointIds = new Set(points.filter((point) => point.status === "active").map((point) => point.id));
  const issueRefs = diagnoses.filter((item) => item.knowledgePointId && item.evidenceRefs?.length).map((item) => item.evidenceRefs ?? []).flat();
  return value.slice(0, 3).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    if (raw.type !== "prerequisite-of" || typeof raw.fromKnowledgePointId !== "string" || typeof raw.toKnowledgePointId !== "string" || !pointIds.has(raw.fromKnowledgePointId) || !pointIds.has(raw.toKnowledgePointId) || raw.fromKnowledgePointId === raw.toKnowledgePointId) return [];
    const sourceRefs = Array.isArray(raw.sourceRefs) ? raw.sourceRefs.filter((ref): ref is { type: "learning-evidence"; id: string } => Boolean(ref && typeof ref === "object" && (ref as Record<string, unknown>).type === "learning-evidence" && typeof (ref as Record<string, unknown>).id === "string")) : [];
    const validRefs = sourceRefs.filter((ref) => issueRefs.some((known) => known.type === ref.type && known.id === ref.id));
    if (validRefs.length === 0) return [];
    return [{ id: crypto.randomUUID(), fromKnowledgePointId: raw.fromKnowledgePointId, toKnowledgePointId: raw.toKnowledgePointId, type: "prerequisite-of" as const, rationale: typeof raw.rationale === "string" && raw.rationale.trim() ? raw.rationale.trim() : "AI 提出的前置关系候选", sourceRefs: validRefs, decision: "pending" as const }];
  });
};

export const requestLearningCoachAnalysis = async (options: {
  ai: AiProviderConfig | undefined;
  snapshot: LearningCoachSnapshot;
  context?: Parameters<typeof sendChatCompletionDetailed>[0]["attachment"];
  knowledgePoints?: KnowledgePoint[];
  knowledgePointDiagnoses?: LearningCoachDiagnosis[];
}) => {
  const provider = getCurrentAiProvider(options.ai);
  const apiKey = provider ? (await storage.getAiSecret(provider.id))?.apiKey : undefined;
  const prompt = [
    "你是学习教练，只能解释以下已经由本地规则得出的诊断，不能改写复习评级、FSRS、任务状态或掌握状态。",
    "请返回 JSON：{\"analysis\":\"简洁中文建议\",\"candidateTasks\":[{\"issueKey\":\"必须来自规则诊断\",\"kind\":\"practice\",\"actionType\":\"ai-quiz|create-record|review-queue\",\"title\":\"...\",\"subject\":\"...\",\"recordIds\":[],\"reason\":\"...\"}],\"relationProposals\":[{\"fromKnowledgePointId\":\"只能来自已确认知识点\",\"toKnowledgePointId\":\"只能来自已确认知识点\",\"type\":\"prerequisite-of\",\"rationale\":\"...\",\"sourceRefs\":[{\"type\":\"learning-evidence\",\"id\":\"...\"}]}]}。候选任务最多 2 条，关系候选最多 3 条，均必须由用户确认后才生效。",
    `本地摘要：${JSON.stringify(options.snapshot.localSummary)}`,
    `规则诊断：${JSON.stringify(options.snapshot.diagnoses)}`,
    `已确认知识点：${JSON.stringify((options.knowledgePoints ?? []).filter((point) => point.status === "active").map(({ id, name, subject }) => ({ id, name, subject })))}`,
    `知识点诊断：${JSON.stringify(options.knowledgePointDiagnoses ?? [])}`,
    `现有正式任务：${JSON.stringify(options.snapshot.taskIds)}`,
    `本次提供的本地来源（仅限这些 Record）：${JSON.stringify(Array.from(new Map((options.context?.selectedChunks ?? []).map((chunk) => [chunk.recordId, { recordId: chunk.recordId, date: chunk.date, subject: chunk.subject, title: chunk.title, sourceLabel: chunk.sourceLabel }])).values()))}`,
  ].join("\n\n");
  const response = await sendChatCompletionDetailed({
    provider,
    apiKey,
    attachment: options.context,
    history: [],
    prompt,
    request: { structuredOutput: true, maxTokens: Math.min(provider?.maxTokens ?? 800, 1200) },
  });
  let parsed: Record<string, unknown> | undefined;
  try { parsed = JSON.parse(response.content) as Record<string, unknown>; } catch { /* Preserve a provider's plain-text answer. */ }
  return {
    content: typeof parsed?.analysis === "string" ? parsed.analysis : response.content,
    candidateTasks: parseCandidates(parsed?.candidateTasks),
    relationProposals: parseRelationProposals(parsed?.relationProposals, options.knowledgePoints ?? [], options.knowledgePointDiagnoses),
  };
};
