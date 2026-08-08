import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContentTemplate } from "../types";

const stamp = "2026-06-21T00:00:00.000Z";

class TemplateTable {
  private rows = new Map<string, ContentTemplate>();

  async get(id: string): Promise<ContentTemplate | undefined> {
    return this.rows.get(id);
  }

  async put(template: ContentTemplate): Promise<string> {
    this.rows.set(template.id, template);
    return template.id;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }

  orderBy(_index: string) {
    return {
      reverse: () => ({
        toArray: async () => Array.from(this.rows.values()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      }),
    };
  }
}

afterEach(() => {
  vi.doUnmock("../db/database");
  vi.resetModules();
});

describe("DexieStorageAdapter templates", () => {
  it("saves, lists, and deletes independent template records", async () => {
    vi.resetModules();
    const templates = new TemplateTable();
    vi.doMock("../db/database", () => ({ db: { templates } }));
    const { DexieStorageAdapter } = await import("./storageAdapter");
    const adapter = new DexieStorageAdapter();
    const template: ContentTemplate = {
      id: "template-1",
      createdAt: stamp,
      updatedAt: stamp,
      title: "  翻译复盘  ",
      contentHtml: "<blockquote>原句</blockquote>",
    };

    const saved = await adapter.saveTemplate(template);

    expect(saved.title).toBe("翻译复盘");
    expect((await adapter.listTemplates()).map((item) => item.id)).toEqual([template.id]);

    await adapter.deleteTemplate(template.id);

    expect(await adapter.listTemplates()).toEqual([]);
  });

  it("does not bump updatedAt when re-saving with unchanged title/contentHtml", async () => {
    vi.resetModules();
    const templates = new TemplateTable();
    vi.doMock("../db/database", () => ({ db: { templates } }));
    const { DexieStorageAdapter } = await import("./storageAdapter");
    const adapter = new DexieStorageAdapter();
    const template: ContentTemplate = {
      id: "template-2",
      createdAt: stamp,
      updatedAt: stamp,
      title: "翻译复盘",
      contentHtml: "<blockquote>原句</blockquote>",
    };
    // The first save always bumps updatedAt (there is no prior "unchanged" record to compare
    // against yet) — capture what it actually produced instead of assuming it stayed at `stamp`.
    const firstSaved = await adapter.saveTemplate(template);

    // Re-save the exact same content later — this simulates opening and saving without any edit.
    const resaved = await adapter.saveTemplate({ ...template, updatedAt: "2026-06-22T00:00:00.000Z" });

    expect(resaved.updatedAt).toBe(firstSaved.updatedAt);
  });

  it("bumps updatedAt when re-saving with a genuinely different contentHtml", async () => {
    vi.resetModules();
    const templates = new TemplateTable();
    vi.doMock("../db/database", () => ({ db: { templates } }));
    const { DexieStorageAdapter } = await import("./storageAdapter");
    const adapter = new DexieStorageAdapter();
    const template: ContentTemplate = {
      id: "template-3",
      createdAt: stamp,
      updatedAt: stamp,
      title: "翻译复盘",
      contentHtml: "<blockquote>原句</blockquote>",
    };
    await adapter.saveTemplate(template);

    const resaved = await adapter.saveTemplate({ ...template, contentHtml: "<blockquote>新句子</blockquote>" });

    expect(resaved.updatedAt).not.toBe(stamp);
  });
});
