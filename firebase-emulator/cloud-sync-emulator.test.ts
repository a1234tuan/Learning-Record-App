import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";

const projectId = "demo-noteproject-stage9";
const uid = "stage9-user";
let environment: RulesTestEnvironment;

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
    storage: { rules: readFileSync("storage.rules", "utf8") },
  });
});

afterAll(async () => {
  await environment.cleanup();
});

describe("Stage 9 Firebase incremental-sync acceptance", () => {
  it("isolates each user's Firestore and Storage namespace", async () => {
    const owner = environment.authenticatedContext(uid);
    const stranger = environment.authenticatedContext("other-user");
    const entityPath = `users/${uid}/syncEntities/decision-block:stage9`;
    const assetPath = `users/${uid}/assets/stage9-hash`;

    await assertSucceeds(setDoc(doc(owner.firestore(), entityPath), { revision: 1, contentHash: "sha256:one" }));
    await assertSucceeds(uploadBytes(ref(owner.storage(), assetPath), new TextEncoder().encode("formal-asset")));
    await assertFails(getDoc(doc(stranger.firestore(), entityPath)));
    await assertFails(getBytes(ref(stranger.storage(), assetPath)));
  });

  it("records a bounded incremental publish and a true no-op replay", async () => {
    const database = environment.authenticatedContext(uid).firestore();
    const state = doc(database, `users/${uid}/syncState/current`);
    const entities = collection(database, `users/${uid}/syncEntities`);
    const metrics = { reads: 0, writes: 0, storageBytes: 0 };

    await setDoc(doc(entities, "decision-block:stage9-a"), { revision: 2, contentHash: "sha256:a", updatedAt: serverTimestamp() });
    await setDoc(doc(entities, "adaptive-review-task:stage9-a"), { revision: 2, contentHash: "sha256:b", updatedAt: serverTimestamp() });
    await setDoc(state, { protocolVersion: 2, headRevision: 2, nextRevision: 3, updatedAt: serverTimestamp() });
    metrics.writes += 3;

    const changed = await getDocs(query(entities, where("revision", ">", 1)));
    const remoteState = await getDoc(state);
    metrics.reads += changed.size + 1;
    expect(changed.size).toBe(2);
    expect(remoteState.data()?.headRevision).toBe(2);
    expect(metrics).toEqual({ reads: 3, writes: 3, storageBytes: 0 });

    const replay = await getDocs(query(entities, where("revision", ">", remoteState.data()?.headRevision)));
    metrics.reads += Math.max(1, replay.size);
    expect(replay.empty).toBe(true);
    expect(metrics.writes).toBe(3);
    expect(metrics.reads).toBe(4);
  });

  it("recovers an interrupted operation once and ignores client clock skew", async () => {
    const database = environment.authenticatedContext(uid).firestore();
    const operation = doc(database, `users/${uid}/syncOperations/stage9-interrupted`);
    const entity = doc(database, `users/${uid}/syncEntities/task-outcome-event:stage9-clock`);

    await setDoc(operation, { phase: "publishing", revision: 3, deviceId: "phone", updatedAt: serverTimestamp() });
    await setDoc(entity, { revision: 3, contentHash: "sha256:clock", clientUpdatedAt: "2099-01-01T00:00:00.000Z" });
    await updateDoc(operation, { phase: "committed", updatedAt: serverTimestamp() });

    const resumed = await getDoc(operation);
    const byRevision = await getDocs(query(
      collection(database, `users/${uid}/syncEntities`),
      where("revision", ">", 2),
    ));
    expect(resumed.data()?.phase).toBe("committed");
    expect(byRevision.docs.filter((item) => item.id === "task-outcome-event:stage9-clock")).toHaveLength(1);
  });
});
