import { describe, expect, it } from "vitest";

import { isLikelyMp3Audio, normalizeMp3Segment } from "./audio";

const frame = new Uint8Array([0xff, 0xfb, 0x90, 0x64]);

describe("normalizeMp3Segment", () => {
  it("removes ID3v2 and ID3v1 metadata before TTS parts are concatenated", () => {
    const bytes = new Uint8Array(10 + frame.length + 128);
    bytes.set([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    bytes.set(frame, 10);
    bytes.set([0x54, 0x41, 0x47], bytes.length - 128);

    expect(normalizeMp3Segment(bytes)).toEqual(frame);
  });

  it("recognizes an MPEG frame and rejects non-audio payloads", () => {
    expect(isLikelyMp3Audio(frame)).toBe(true);
    expect(isLikelyMp3Audio(new TextEncoder().encode("{\"error\":true}"))).toBe(false);
  });
});
