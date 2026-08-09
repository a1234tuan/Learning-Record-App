import { describe, expect, it } from "vitest";

import { createDefaultTtsProviders, createTtsProviderTemplate, normalizeTtsProvider } from "./ttsProviders";

describe("Doubao TTS provider configuration", () => {
  it("uses a stable identity for the built-in provider", () => {
    expect(createDefaultTtsProviders()).toEqual(createDefaultTtsProviders());
  });

  it("defaults to the Doubao 2.0 Tina voice", () => {
    expect(createTtsProviderTemplate("doubao")).toMatchObject({
      providerId: "doubao",
      model: "seed-tts-2.0",
      voice: "zh_female_yingyujiaoxue_uranus_bigtts",
    });
  });

  it("keeps a Doubao 1.0 profile and voice during normalization", () => {
    expect(normalizeTtsProvider({
      providerId: "doubao",
      providerName: "豆包语音 1.0",
      model: "seed-tts-1.0",
      voice: "ICL_zh_female_nuanxinxuejie_tob",
    })).toMatchObject({
      providerId: "doubao",
      model: "seed-tts-1.0",
      voice: "ICL_zh_female_nuanxinxuejie_tob",
    });
  });
});
