const ID3V2_HEADER_SIZE = 10;
const ID3V1_TAG_SIZE = 128;

const hasId3v2Header = (bytes: Uint8Array): boolean =>
  bytes.length >= ID3V2_HEADER_SIZE && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;

const id3v2TotalSize = (bytes: Uint8Array): number => {
  if (!hasId3v2Header(bytes)) return 0;
  const payloadSize = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  const footerSize = bytes[5] & 0x10 ? ID3V2_HEADER_SIZE : 0;
  const total = ID3V2_HEADER_SIZE + payloadSize + footerSize;
  return total <= bytes.length ? total : 0;
};

const hasId3v1Trailer = (bytes: Uint8Array, end: number): boolean =>
  end >= ID3V1_TAG_SIZE && bytes[end - ID3V1_TAG_SIZE] === 0x54 && bytes[end - ID3V1_TAG_SIZE + 1] === 0x41 && bytes[end - ID3V1_TAG_SIZE + 2] === 0x47;

/** Removes ID3 blocks from a single segment or a legacy concatenated MP3 stream. */
export const normalizeMp3Segment = (bytes: Uint8Array): Uint8Array => {
  const output: number[] = [];
  let index = 0;
  while (index < bytes.length) {
    const remaining = bytes.length - index;
    const id3Size = id3v2TotalSize(bytes.subarray(index));
    if (id3Size > 0) {
      index += id3Size;
      continue;
    }
    if (remaining >= ID3V1_TAG_SIZE && hasId3v1Trailer(bytes, index + ID3V1_TAG_SIZE)) {
      index += ID3V1_TAG_SIZE;
      continue;
    }
    output.push(bytes[index]);
    index += 1;
  }
  return Uint8Array.from(output);
};

export const normalizeMp3Stream = normalizeMp3Segment;

export const isLikelyMp3Audio = (bytes: Uint8Array): boolean => {
  const scanLimit = Math.min(bytes.length - 3, 128 * 1024);
  for (let index = 0; index < scanLimit; index += 1) {
    if (bytes[index] !== 0xff || (bytes[index + 1] & 0xe0) !== 0xe0) continue;
    const version = (bytes[index + 1] >> 3) & 0x03;
    const layer = (bytes[index + 1] >> 1) & 0x03;
    const bitrate = (bytes[index + 2] >> 4) & 0x0f;
    const sampleRate = (bytes[index + 2] >> 2) & 0x03;
    if (version !== 0x01 && layer !== 0 && bitrate !== 0 && bitrate !== 0x0f && sampleRate !== 0x03) return true;
  }
  return false;
};

export const readBlobBytes = async (blob: Blob): Promise<Uint8Array> => {
  if (typeof blob.arrayBuffer === "function") {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("无法读取音频数据。"));
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });
};
