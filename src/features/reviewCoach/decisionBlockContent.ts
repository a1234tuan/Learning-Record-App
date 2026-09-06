import type { DecisionBlockArchiveReason } from "./domain";

export const DECISION_BLOCK_TAG = "record-decision-block";

export interface DecisionBlockContentNode {
  decisionBlockId: string;
  contentVersion: number;
  createdAt: string;
  updatedAt: string;
  position: number;
  contentHtml: string;
  innerHtml: string;
}

export interface PendingDecisionBlockRemoval {
  decisionBlockId: string;
  reason: Extract<DecisionBlockArchiveReason, "deleted" | "converted-to-plain">;
  contentHtml: string;
}

export interface PreparedDecisionBlockRemoval extends DecisionBlockContentNode {
  reason: PendingDecisionBlockRemoval["reason"];
  archivedAt: string;
}

export interface PreparedDecisionBlockContent {
  contentHtml: string;
  blocks: DecisionBlockContentNode[];
  removals: PreparedDecisionBlockRemoval[];
}

const parseDocument = (html: string): Document =>
  new DOMParser().parseFromString(html || "<p></p>", "text/html");

const positiveVersion = (value: string | null): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
};

const blockId = (element: Element): string =>
  element.getAttribute("data-decision-block-id")?.trim() ?? "";

const blockStamp = (element: Element, name: "created" | "updated", fallback: string): string =>
  element.getAttribute(`data-${name}-at`)?.trim() || fallback;

const applyIdentity = (
  element: Element,
  identity: Pick<DecisionBlockContentNode, "decisionBlockId" | "contentVersion" | "createdAt" | "updatedAt">,
) => {
  element.setAttribute("data-decision-block-id", identity.decisionBlockId);
  element.setAttribute("data-content-version", String(identity.contentVersion));
  element.setAttribute("data-created-at", identity.createdAt);
  element.setAttribute("data-updated-at", identity.updatedAt);
};

const toContentNode = (element: Element, position: number, fallbackStamp: string): DecisionBlockContentNode => ({
  decisionBlockId: blockId(element),
  contentVersion: positiveVersion(element.getAttribute("data-content-version")),
  createdAt: blockStamp(element, "created", fallbackStamp),
  updatedAt: blockStamp(element, "updated", fallbackStamp),
  position,
  contentHtml: element.outerHTML,
  innerHtml: element.innerHTML,
});

export const newDecisionBlockId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `decision-block-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const renewDecisionBlockIdentitiesInHtml = (
  contentHtml: string,
  stamp: string,
  createId: () => string = newDecisionBlockId,
): string => {
  const document = parseDocument(contentHtml);
  for (const element of Array.from(document.querySelectorAll(DECISION_BLOCK_TAG))) {
    applyIdentity(element, {
      decisionBlockId: createId(),
      contentVersion: 1,
      createdAt: stamp,
      updatedAt: stamp,
    });
  }
  return document.body.innerHTML || "<p></p>";
};

export const extractDecisionBlocks = (contentHtml: string, fallbackStamp = ""): DecisionBlockContentNode[] =>
  Array.from(parseDocument(contentHtml).querySelectorAll(DECISION_BLOCK_TAG))
    .map((element, position) => toContentNode(element, position, fallbackStamp));

const parseRemovalElement = (removal: PendingDecisionBlockRemoval): Element | undefined => {
  const document = parseDocument(removal.contentHtml);
  const exact = Array.from(document.querySelectorAll(DECISION_BLOCK_TAG))
    .find((element) => blockId(element) === removal.decisionBlockId);
  return exact ?? document.querySelector(DECISION_BLOCK_TAG) ?? undefined;
};

export const prepareDecisionBlockContentForSave = (
  previousContentHtml: string,
  nextContentHtml: string,
  stamp: string,
  pendingRemovals: readonly PendingDecisionBlockRemoval[] = [],
  createId: () => string = newDecisionBlockId,
  restoredDecisionBlocks: ReadonlyMap<string, string> = new Map(),
): PreparedDecisionBlockContent => {
  const previousBlocks = extractDecisionBlocks(previousContentHtml, stamp);
  const previousById = new Map(previousBlocks.map((block) => [block.decisionBlockId, block]));
  const pendingById = new Map(pendingRemovals.map((removal) => [removal.decisionBlockId, removal]));
  const document = parseDocument(nextContentHtml);
  const seenIds = new Set<string>();

  Array.from(document.querySelectorAll(DECISION_BLOCK_TAG)).forEach((element) => {
    const requestedId = blockId(element);
    const duplicate = requestedId !== "" && seenIds.has(requestedId);
    const decisionBlockId = !requestedId || duplicate ? createId() : requestedId;
    const previous = duplicate ? undefined : previousById.get(decisionBlockId);
    const contentChanged = Boolean(previous && previous.innerHtml !== element.innerHTML);
    const restoredElement = !previous && !duplicate && restoredDecisionBlocks.has(decisionBlockId)
      ? parseRemovalElement({
          decisionBlockId,
          reason: "deleted",
          contentHtml: restoredDecisionBlocks.get(decisionBlockId) ?? "",
        })
      : undefined;
    const restoredContentChanged = Boolean(restoredElement && restoredElement.innerHTML !== element.innerHTML);
    const identity = previous
      ? {
          decisionBlockId,
          contentVersion: previous.contentVersion + (contentChanged ? 1 : 0),
          createdAt: previous.createdAt || stamp,
          updatedAt: contentChanged ? stamp : previous.updatedAt || stamp,
        }
      : {
          decisionBlockId,
          contentVersion: restoredElement
            ? positiveVersion(restoredElement.getAttribute("data-content-version")) + (restoredContentChanged ? 1 : 0)
            : 1,
          createdAt: restoredElement ? blockStamp(restoredElement, "created", stamp) : duplicate ? stamp : blockStamp(element, "created", stamp),
          updatedAt: restoredContentChanged ? stamp : restoredElement
            ? blockStamp(restoredElement, "updated", stamp)
            : duplicate ? stamp : blockStamp(element, "updated", stamp),
        };
    applyIdentity(element, identity);
    seenIds.add(decisionBlockId);
  });

  const blocks = Array.from(document.querySelectorAll(DECISION_BLOCK_TAG))
    .map((element, position) => toContentNode(element, position, stamp));
  const activeIds = new Set(blocks.map((block) => block.decisionBlockId));
  const removals = previousBlocks
    .filter((previous) => previous.decisionBlockId && !activeIds.has(previous.decisionBlockId))
    .map((previous): PreparedDecisionBlockRemoval => {
      const pending = pendingById.get(previous.decisionBlockId);
      const element = pending ? parseRemovalElement(pending) : undefined;
      const changedBeforeRemoval = Boolean(element && element.innerHTML !== previous.innerHtml);
      const identity = {
        decisionBlockId: previous.decisionBlockId,
        contentVersion: previous.contentVersion + (changedBeforeRemoval ? 1 : 0),
        createdAt: previous.createdAt || stamp,
        updatedAt: changedBeforeRemoval ? stamp : previous.updatedAt || stamp,
      };
      if (element) applyIdentity(element, identity);
      const archived = element
        ? toContentNode(element, previous.position, stamp)
        : { ...previous, ...identity };
      return {
        ...archived,
        contentHtml: element?.outerHTML ?? previous.contentHtml,
        innerHtml: element?.innerHTML ?? previous.innerHtml,
        reason: pending?.reason ?? "deleted",
        archivedAt: stamp,
      };
    });

  return { contentHtml: document.body.innerHTML || "<p></p>", blocks, removals };
};

export const decisionBlockPreview = (contentHtml: string, maxLength = 32): string => {
  const element = parseDocument(contentHtml).querySelector(DECISION_BLOCK_TAG);
  const text = element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  if (!text) return "空白复习重点";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};
