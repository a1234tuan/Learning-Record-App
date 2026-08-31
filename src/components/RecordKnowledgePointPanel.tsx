import { BrainCircuit, Link2, Merge, RotateCcw, Unlink } from "lucide-react";
import { useMemo, useState } from "react";

import type { KnowledgePoint, KnowledgePointExtractionRun, RecordBlock, RecordKnowledgePointLink } from "../types";
import { canonicalStudySubject } from "../lib/subjects";
import { isMeaningfulLearningRecord } from "../lib/learningFacts";

interface RecordKnowledgePointPanelProps {
  record: RecordBlock;
  points: KnowledgePoint[];
  links: RecordKnowledgePointLink[];
  extractionRuns: KnowledgePointExtractionRun[];
  aiAvailable: boolean;
  requiredKnowledgePointId?: string;
  onConfirmLink: (input: { name: string; existingKnowledgePointId?: string; sourceQuote?: string; confirmationSource: "manual" | "ai-proposal" }) => Promise<void>;
  onRemoveLink: (linkId: string) => Promise<void>;
  onExtract: () => Promise<void>;
  onDecideProposal: (runId: string, proposalId: string, decision: "accepted" | "rejected", existingKnowledgePointId?: string) => Promise<void>;
  onMerge: (sourceId: string, targetId: string) => Promise<void>;
  onUndoMerge: (sourceId: string) => Promise<void>;
}

const runStatus = (run: KnowledgePointExtractionRun) => {
  if (run.status === "running") return run.phase === "calling-provider" ? "AI 正在分析这一条记录" : "正在准备这条记录的上下文";
  if (run.status === "failed") return `本次提取失败：${run.error ?? "未知错误"}`;
  if (run.status === "stale") return "记录或知识点目录已变化，这批建议已失效";
  return run.proposals.length === 0 ? "本次没有得到可验证的知识点建议" : `得到 ${run.proposals.length} 条候选，确认后才会成为正式知识点`;
};

export const RecordKnowledgePointPanel = ({
  record,
  points,
  links,
  extractionRuns,
  aiAvailable,
  requiredKnowledgePointId,
  onConfirmLink,
  onRemoveLink,
  onExtract,
  onDecideProposal,
  onMerge,
  onUndoMerge,
}: RecordKnowledgePointPanelProps) => {
  const [name, setName] = useState("");
  const [existingId, setExistingId] = useState("");
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});
  const [proposalTargets, setProposalTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const subject = canonicalStudySubject(record.subject);
  const activePoints = useMemo(() => points.filter((point) => point.status === "active" && canonicalStudySubject(point.subject) === subject), [points, subject]);
  const pointById = new Map(points.map((point) => [point.id, point]));
  const activeLinks = links.filter((link) => link.recordId === record.id && link.status === "active");
  const linkedPointIds = new Set(activeLinks.map((link) => link.knowledgePointId));
  const latestRun = extractionRuns.filter((run) => run.recordId === record.id).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0];
  const requiredPoint = requiredKnowledgePointId ? pointById.get(requiredKnowledgePointId) : undefined;
  const requirementSatisfied = Boolean(requiredPoint && linkedPointIds.has(requiredPoint.id));
  const mergedIntoLinked = points.filter((point) => point.status === "merged" && point.mergedIntoId && linkedPointIds.has(point.mergedIntoId));

  const perform = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await work(); } finally { setBusy(false); }
  };

  return <section className="record-knowledge-points" aria-label="记录知识点">
    <header>
      <div><p className="eyebrow">Knowledge Points</p><h2>这条记录涉及什么</h2></div>
      <button type="button" className="secondary-button" disabled={busy || !aiAvailable || !isMeaningfulLearningRecord(record)} onClick={() => void perform(onExtract)}><BrainCircuit size={16} />AI 提取建议</button>
    </header>
    <p className="settings-hint">这里只保存你确认过、可被多条记录持续引用的知识实体。AI 建议不会自动写入。</p>

    {requiredPoint && <div className={`knowledge-point-requirement${requirementSatisfied ? " is-satisfied" : ""}`}>
      <strong>{requirementSatisfied ? "纠错记录已关联" : `完成本次纠错还需关联“${requiredPoint.name}”`}</strong>
      <span>{requirementSatisfied ? "保存有效内容后，系统会把记录和正式关联共同作为行动结果。" : "先保存有效学习内容，再由你确认这条正式关联；普通记录不受此要求影响。"}</span>
      {!requirementSatisfied && <button type="button" className="primary-button" disabled={busy || !isMeaningfulLearningRecord(record)} onClick={() => void perform(() => onConfirmLink({ name: requiredPoint.name, existingKnowledgePointId: requiredPoint.id, confirmationSource: "manual" }))}><Link2 size={16} />确认关联</button>}
    </div>}

    <div className="knowledge-point-links">
      {activeLinks.length === 0 ? <p>尚未确认知识点。</p> : activeLinks.map((link) => {
        const point = pointById.get(link.knowledgePointId);
        if (!point) return null;
        const candidates = activePoints.filter((item) => item.id !== point.id);
        return <div className="knowledge-point-link" key={link.id}>
          <span><strong>{point.name}</strong><small>{link.role === "primary" ? "主要涉及" : "辅助涉及"}{link.sourceQuote ? ` · 来源：“${link.sourceQuote}”` : " · 由你确认"}</small></span>
          <div>
            {candidates.length > 0 && <><select aria-label={`将 ${point.name} 合并到`} value={mergeTargets[point.id] ?? ""} onChange={(event) => setMergeTargets((current) => ({ ...current, [point.id]: event.target.value }))}><option value="">合并到...</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select><button type="button" className="icon-button" title="合并知识点" aria-label={`合并 ${point.name}`} disabled={busy || !mergeTargets[point.id]} onClick={() => void perform(() => onMerge(point.id, mergeTargets[point.id]))}><Merge size={16} /></button></>}
            <button type="button" className="icon-button" title="解除这条记录的关联" aria-label={`解除 ${point.name} 关联`} disabled={busy} onClick={() => void perform(() => onRemoveLink(link.id))}><Unlink size={16} /></button>
          </div>
        </div>;
      })}
    </div>

    {mergedIntoLinked.map((point) => <div className="knowledge-point-undo" key={point.id}><span>“{point.name}”已合并，可恢复原知识点和来源关联。</span><button type="button" className="secondary-button" disabled={busy} onClick={() => void perform(() => onUndoMerge(point.id))}><RotateCcw size={15} />撤销合并</button></div>)}

    <div className="knowledge-point-add">
      <select aria-label="选择已有知识点" value={existingId} onChange={(event) => { setExistingId(event.target.value); const point = pointById.get(event.target.value); if (point) setName(point.name); }}><option value="">新建知识点</option>{activePoints.filter((point) => !linkedPointIds.has(point.id)).map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}</select>
      <input value={name} onChange={(event) => { setName(event.target.value); setExistingId(""); }} placeholder="输入稳定、具体的知识点名称" aria-label="知识点名称" />
      <button type="button" className="secondary-button" disabled={busy || !name.trim() || !isMeaningfulLearningRecord(record)} onClick={() => void perform(async () => { await onConfirmLink({ name, existingKnowledgePointId: existingId || undefined, confirmationSource: "manual" }); setName(""); setExistingId(""); })}><Link2 size={16} />确认并关联</button>
    </div>

    {!aiAvailable && <p className="settings-hint">远程 AI 未配置，暂不能提取建议；仍可手工确认知识点。</p>}
    {latestRun && <div className="knowledge-point-proposals"><p>{runStatus(latestRun)}</p>{latestRun.status === "succeeded" && latestRun.proposals.filter((proposal) => proposal.decision === "pending").map((proposal) => {
      const selectedTarget = proposalTargets[proposal.id] ?? proposal.suggestedExistingKnowledgePointId ?? "";
      return <article key={proposal.id}>
        <div><strong>{proposal.name}</strong>{proposal.definition && <span>{proposal.definition}</span>}<small>记录原文：“{proposal.sourceQuote}”</small></div>
        <select aria-label={`${proposal.name} 的确认方式`} value={selectedTarget} onChange={(event) => setProposalTargets((current) => ({ ...current, [proposal.id]: event.target.value }))}><option value="">确认为新知识点</option>{activePoints.map((point) => <option key={point.id} value={point.id}>关联已有：{point.name}</option>)}</select>
        <div><button type="button" className="secondary-button" disabled={busy} onClick={() => void perform(() => onDecideProposal(latestRun.id, proposal.id, "rejected"))}>拒绝</button><button type="button" className="primary-button" disabled={busy} onClick={() => void perform(() => onDecideProposal(latestRun.id, proposal.id, "accepted", selectedTarget || undefined))}>确认关联</button></div>
      </article>;
    })}</div>}
  </section>;
};
