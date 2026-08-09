import { describe, expect, it } from "vitest";

import { FirebaseStorageUsageRequestGate } from "./firebaseStorageUsageRequestGate";

describe("FirebaseStorageUsageRequestGate", () => {
  it("rejects duplicate requests for the same account generation", () => {
    const gate = new FirebaseStorageUsageRequestGate();
    const request = { uid: "user-1", generation: 3 };

    expect(gate.begin(request)).toBe(true);
    expect(gate.begin(request)).toBe(false);
    gate.end(request);
    expect(gate.begin(request)).toBe(true);
  });

  it("allows a new account generation while an older one is finishing", () => {
    const gate = new FirebaseStorageUsageRequestGate();
    const oldRequest = { uid: "user-1", generation: 3 };
    const newRequest = { uid: "user-1", generation: 4 };

    expect(gate.begin(oldRequest)).toBe(true);
    expect(gate.begin(newRequest)).toBe(true);
    gate.end(oldRequest);
    expect(gate.begin(newRequest)).toBe(false);
    gate.end(newRequest);
    expect(gate.begin(newRequest)).toBe(true);
  });
});
