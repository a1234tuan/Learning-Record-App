import { strict as assert } from "node:assert";
import test from "node:test";

import { summarizeStorageFiles } from "./storageUsage";

test("summarizeStorageFiles totals valid Cloud Storage object sizes", () => {
  const summary = summarizeStorageFiles([
    { metadata: { size: "128" } },
    { metadata: { size: 256 } },
    { metadata: { size: undefined } },
    { metadata: { size: "not-a-number" } },
    { metadata: { size: -1 } },
  ]);

  assert.deepEqual(summary, { usedBytes: 384, objectCount: 5 });
});

test("summarizeStorageFiles handles an empty prefix", () => {
  assert.deepEqual(summarizeStorageFiles([]), { usedBytes: 0, objectCount: 0 });
});
