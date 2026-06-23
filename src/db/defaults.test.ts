import { describe, expect, it } from "vitest";

import { createDefaultAiPresets, DEFAULT_SETTINGS, isLegacyDefaultAiPresetSet } from "./defaults";
import { createBaseEntity } from "../lib/entity";

describe("default AI settings", () => {
  it("uses DeepSeek v4 pro compatible defaults", () => {
    expect(DEFAULT_SETTINGS.ai).toMatchObject({
      providerName: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
    });
  });

  it("creates the five built-in learning coach prompts", () => {
    const presets = createDefaultAiPresets();

    expect(presets.map((preset) => preset.title)).toEqual([
      "白纸复述测试",
      "变形应用题",
      "盲区挖掘",
      "费曼讲解测试",
      "我的理解对不对",
    ]);
    expect(presets[0].prompt).toContain("请扮演严格考官");
    expect(presets[2].prompt).toContain("未知的未知");
    expect(presets[4].prompt).toContain("请等我输入");
  });

  it("detects the old four-prompt default set without matching custom prompt sets", () => {
    const oldPresets = ["5 道自测题", "随机抽问", "薄弱点总结", "明日复习计划"].map((title, order) => ({
      ...createBaseEntity(),
      title,
      prompt: title,
      order,
    }));

    expect(isLegacyDefaultAiPresetSet(oldPresets)).toBe(true);
    expect(isLegacyDefaultAiPresetSet(createDefaultAiPresets())).toBe(false);
    expect(isLegacyDefaultAiPresetSet([{ ...oldPresets[0], title: "我自己的提示词" }])).toBe(false);
  });
});
