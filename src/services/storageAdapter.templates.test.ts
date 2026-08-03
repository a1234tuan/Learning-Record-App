import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContentTemplate } from "../types";

const stamp = "2026-06-21T00:00:00.000Z";

class TemplateTable {
  private rows = new Map<string, ContentTemplate>();

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
});
