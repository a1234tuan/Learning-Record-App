import type { AiContextPack, AiProviderConfig, KnowledgePoint, KnowledgePointProposal, RecordBlock } from "../types";
import { createBaseEntity } from "../lib/entity";
import { getCurrentAiProvider } from "../lib/aiProviders";
import { canonicalStudySubject } from "../lib/subjects";
import { recordLearningText } from "../lib/learningFacts";
import { sendChatCompletionDetailed } from "./aiClientService";
import { storage } from "./storageAdapter";
import { normalizeKnowledgePointName } from "../lib/knowledgePointIdentity";

const proposalsFrom = (value: unknown, record: RecordBlock, catalog: KnowledgePoint[]): KnowledgePointProposal[] => {
  if (!Array.isArray(value)) return [];
  const sourceText = `${record.title}\n${recordLearningText(record)}`;
  const subject = canonicalStudySubject(record.subject);
  const activeCatalog = catalog.filter((point) => point.status === "active" && canonicalStudySubject(point.subject) === subject);
  const seen = new Set<string>();
  return value.slice(0, 5).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 80) : "";
    const sourceQuote = typeof raw.sourceQuote === "string" ? raw.sourceQuote.trim().slice(0, 240) : "";
    const normalizedKey = normalizeKnowledgePointName(name);
    if (!name || !sourceQuote || seen.has(normalizedKey) || !sourceText.includes(sourceQuote)) return [];
    seen.add(normalizedKey);
    const existing = activeCatalog.find((point) => point.normalizedKey === normalizedKey || point.aliases.some((alias) => normalizeKnowledgePointName(alias) === normalizedKey));
    return [{
      id: createBaseEntity().id,
      name,
      normalizedKey,
      definition: typeof raw.definition === "string" && raw.definition.trim() ? raw.definition.trim().slice(0, 240) : undefined,
      sourceQuote,
      suggestedExistingKnowledgePointId: existing?.id,
      decision: "pending",
    }];
  });
};

export const requestKnowledgePointProposals = async (options: {
  ai: AiProviderConfig | undefined;
  record: RecordBlock;
  catalog: KnowledgePoint[];
  context: AiContextPack;
}): Promise<KnowledgePointProposal[]> => {
  const provider = getCurrentAiProvider(options.ai);
  const apiKey = provider ? (await storage.getAiSecret(provider.id))?.apiKey : undefined;
  const subject = canonicalStudySubject(options.record.subject);
  const catalog = options.catalog
    .filter((point) => point.status === "active" && canonicalStudySubject(point.subject) === subject)
    .map(({ id, name, aliases }) => ({ id, name, aliases }))
    .slice(0, 100);
  const prompt = [
    "从当前这一条正式学习记录中提出最多 5 个稳定、可被后续多条学习事实重复引用的知识点候选。",
    "候选只是 proposal，不能判断掌握程度，不能修改正式数据。不要输出泛化学科名、学习行为或一次性描述。",
    "sourceQuote 必须逐字来自记录标题或正文；否则候选会被丢弃。优先复用给出的已有知识点目录，名称保持简洁具体。",
    `记录科目：${subject}`,
    `已有知识点目录：${JSON.stringify(catalog)}`,
    '只返回 JSON：{"proposals":[{"name":"...","definition":"可选简短定义","sourceQuote":"记录中的原文"}]}',
  ].join("\n\n");
  const response = await sendChatCompletionDetailed({
    provider,
    apiKey,
    attachment: options.context,
    history: [],
    prompt,
    request: { structuredOutput: true, maxTokens: Math.min(provider?.maxTokens ?? 900, 1400) },
  });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(response.content) as Record<string, unknown>;
  } catch {
    throw new Error("AI 没有返回可验证的知识点建议，请重试。");
  }
  return proposalsFrom(body.proposals, options.record, options.catalog);
};
