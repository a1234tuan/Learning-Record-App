/**
 * TC3-HMAC-SHA256 request signing for Tencent Cloud's TextToVoice API.
 * https://cloud.tencent.com/document/api/1073/37884
 *
 * Uses Web Crypto (SubtleCrypto) so this runs in both the browser and the
 * Electron renderer without a Node crypto dependency. The Electron main
 * process (desktop/main.cjs) is plain CommonJS and re-implements the same
 * algorithm with node:crypto since it can't import this module.
 */

const encoder = new TextEncoder();

const toHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return toHex(digest);
};

const hmacSha256 = async (key: BufferSource, message: string): Promise<ArrayBuffer> => {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
};

export interface TencentSigningInput {
  secretId: string;
  secretKey: string;
  host: string;
  action: string;
  version: string;
  region: string;
  payload: string;
  /** Unix timestamp in seconds; defaults to now. */
  timestamp?: number;
}

export interface TencentSignedHeaders {
  [key: string]: string;
  Authorization: string;
  "Content-Type": string;
  Host: string;
  "X-TC-Action": string;
  "X-TC-Timestamp": string;
  "X-TC-Version": string;
  "X-TC-Region": string;
}

const SERVICE = "tts";
const ALGORITHM = "TC3-HMAC-SHA256";

export const signTencentRequest = async (input: TencentSigningInput): Promise<TencentSignedHeaders> => {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const contentType = "application/json; charset=utf-8";

  const canonicalHeaders = `content-type:${contentType}\nhost:${input.host}\n`;
  const signedHeaders = "content-type;host";
  const hashedPayload = await sha256Hex(input.payload);
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, hashedPayload].join("\n");

  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const hashedCanonicalRequest = await sha256Hex(canonicalRequest);
  const stringToSign = [ALGORITHM, String(timestamp), credentialScope, hashedCanonicalRequest].join("\n");

  const secretDate = await hmacSha256(encoder.encode(`TC3${input.secretKey}`), date);
  const secretService = await hmacSha256(secretDate, SERVICE);
  const secretSigning = await hmacSha256(secretService, "tc3_request");
  const signature = toHex(await hmacSha256(secretSigning, stringToSign));

  const authorization = `${ALGORITHM} Credential=${input.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    Authorization: authorization,
    "Content-Type": contentType,
    Host: input.host,
    "X-TC-Action": input.action,
    "X-TC-Timestamp": String(timestamp),
    "X-TC-Version": input.version,
    "X-TC-Region": input.region,
  };
};
