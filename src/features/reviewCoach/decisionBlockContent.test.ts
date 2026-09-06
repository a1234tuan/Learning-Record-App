import { describe, expect, it } from "vitest";

import {
  extractDecisionBlocks,
  prepareDecisionBlockContentForSave,
  renewDecisionBlockIdentitiesInHtml,
} from "./decisionBlockContent";

const oldStamp = "2026-09-01T08:00:00.000Z";
const newStamp = "2026-09-04T08:00:00.000Z";
const block = (content: string, version = 3) =>
  `<record-decision-block data-decision-block-id="block-1" data-content-version="${version}" data-created-at="${oldStamp}" data-updated-at="${oldStamp}">${content}</record-decision-block>`;

describe("decision block content persistence", () => {
  it("increments only the saved block whose inner content changed", () => {
    const previous = `<p>前文</p>${block("<p>队列在入队时标记。</p>")}<p>后文</p>`;
    const outsideOnly = prepareDecisionBlockContentForSave(previous, previous.replace("前文", "修改前文"), newStamp);
    const inside = prepareDecisionBlockContentForSave(previous, previous.replace("入队时", "出队时"), newStamp);

    expect(outsideOnly.blocks[0]).toMatchObject({ decisionBlockId: "block-1", contentVersion: 3, updatedAt: oldStamp });
    expect(inside.blocks[0]).toMatchObject({ decisionBlockId: "block-1", contentVersion: 4, updatedAt: newStamp });
  });

  it("gives a copied occurrence a new identity starting at version one", () => {
    const previous = block("<p>原内容</p>");
    const prepared = prepareDecisionBlockContentForSave(
      previous,
      `${previous}${previous}`,
      newStamp,
      [],
      () => "copied-block",
    );

    expect(prepared.blocks.map((item) => [item.decisionBlockId, item.contentVersion])).toEqual([
      ["block-1", 3],
      ["copied-block", 1],
    ]);
  });

  it("upgrades legacy decision-block HTML without an identity on save", () => {
    const prepared = prepareDecisionBlockContentForSave(
      "<p>旧正文</p>",
      "<record-decision-block><p>旧版重点</p></record-decision-block>",
      newStamp,
      [],
      () => "legacy-upgraded-block",
    );

    expect(prepared.blocks[0]).toMatchObject({
      decisionBlockId: "legacy-upgraded-block",
      contentVersion: 1,
      createdAt: newStamp,
      updatedAt: newStamp,
    });
    expect(prepared.contentHtml).toContain('data-decision-block-id="legacy-upgraded-block"');
  });

  it("archives the latest complete fragment when an edited block is removed", () => {
    const previous = block('<p>旧内容</p><record-asset data-asset-id="image-1" data-kind="image" data-title="板书"></record-asset>');
    const latest = block('<p>新内容</p><record-asset data-asset-id="image-1" data-kind="image" data-title="板书"></record-asset>');
    const prepared = prepareDecisionBlockContentForSave(previous, "<p>普通正文</p>", newStamp, [{
      decisionBlockId: "block-1",
      reason: "converted-to-plain",
      contentHtml: latest,
    }]);

    expect(prepared.removals[0]).toMatchObject({
      decisionBlockId: "block-1",
      contentVersion: 4,
      reason: "converted-to-plain",
    });
    expect(prepared.removals[0].contentHtml).toContain('data-asset-id="image-1"');
    expect(extractDecisionBlocks(prepared.removals[0].contentHtml)[0].innerHtml).toContain("新内容");
  });

  it("renews identities when reusable HTML is inserted outside the clipboard path", () => {
    const renewed = renewDecisionBlockIdentitiesInHtml(
      `${block("<p>模板重点一</p>")}${block("<p>模板重点二</p>")}`,
      newStamp,
      (() => {
        let id = 0;
        return () => `new-block-${++id}`;
      })(),
    );

    expect(extractDecisionBlocks(renewed)).toEqual([
      expect.objectContaining({ decisionBlockId: "new-block-1", contentVersion: 1, createdAt: newStamp, updatedAt: newStamp }),
      expect.objectContaining({ decisionBlockId: "new-block-2", contentVersion: 1, createdAt: newStamp, updatedAt: newStamp }),
    ]);
  });

  it("keeps a pure restore at its archived version and increments an edited restore", () => {
    const archived = block("<p>归档内容</p>");
    const restored = prepareDecisionBlockContentForSave(
      "<p>当前正文</p>",
      `<p>当前正文</p>${archived}`,
      newStamp,
      [],
      undefined,
      new Map([["block-1", archived]]),
    );
    const edited = prepareDecisionBlockContentForSave(
      "<p>当前正文</p>",
      `<p>当前正文</p>${archived.replace("归档内容", "恢复后修改")}`,
      newStamp,
      [],
      undefined,
      new Map([["block-1", archived]]),
    );

    expect(restored.blocks[0]).toMatchObject({ contentVersion: 3, updatedAt: oldStamp });
    expect(edited.blocks[0]).toMatchObject({ contentVersion: 4, updatedAt: newStamp });
  });
});
