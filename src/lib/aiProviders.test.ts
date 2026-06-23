import { describe, expect, it } from "vitest";

import { createAiProviderTemplate, normalizeAiConfig } from "./aiProviders";
import { createDefaultAiPresets } from "../db/defaults";

describe("aiProviders", () => {
  it("creates built-in provider templates", () => {
    expect(createAiProviderTemplate("nvidia")).toMatchObject({
      providerName: "NVIDIA",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      model: "meta/llama-3.3-70b-instruct",
    });
    expect(createAiProviderTemplate("aliyun")).toMatchObject({
      providerName: "阿里云百炼",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-plus",
    });
    expect(createAiProviderTemplate("custom-proxy")).toMatchObject({
      providerName: "自定义中转 API",
      baseUrl: "https://api.vectorengine.ai",
      model: "",
    });
  });

  it("migrates legacy single-provider AI settings into provider profiles", () => {
    const presets = createDefaultAiPresets();
    const migrated = normalizeAiConfig({
      providerName: "硅基流动",
      baseUrl: "https://api.siliconflow.cn/v1",
      model: "deepseek-ai/DeepSeek-V3",
      temperature: 0.2,
      maxTokens: 2048,
      memoryTurns: 8,
    }, presets);

    expect(migrated.currentProviderId).toBe("default");
    expect(migrated.providers).toHaveLength(1);
    expect(migrated.providers[0]).toMatchObject({
      id: "default",
      providerName: "硅基流动",
      baseUrl: "https://api.siliconflow.cn/v1",
      model: "deepseek-ai/DeepSeek-V3",
      temperature: 0.2,
      maxTokens: 2048,
      memoryTurns: 8,
    });
    expect(migrated.presets).toBe(presets);
  });
});
