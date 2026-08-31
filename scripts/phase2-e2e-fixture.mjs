/**
 * Seeds a disposable browser profile with legal Phase 2 preconditions.
 * This script never opens or writes the user's normal profile. Start Chrome
 * with --user-data-dir outside the repository and expose it on port 9225.
 */
const endpoint = process.env.PHASE2_CDP ?? "http://127.0.0.1:9225";
const pages = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const page = pages.find((item) => item.type === "page" && item.url.startsWith("http://127.0.0.1:4173"));
if (!page) throw new Error("No Phase 2 browser page found on http://127.0.0.1:4173");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const request = pending.get(message.id);
  pending.delete(message.id);
  message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
};
await send("Runtime.enable");
await send("Page.enable");
await new Promise((resolve) => setTimeout(resolve, 800));

const result = await evaluate(`(async () => {
  const prefix = "phase2-fixture-";
  const now = new Date();
  const iso = now.toISOString();
  const date = iso.slice(0, 10);
  const previousDate = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const hash = (value, prefixName) => {
    const source = JSON.stringify(value);
    let hashValue = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hashValue ^= source.charCodeAt(index);
      hashValue = Math.imul(hashValue, 16777619);
    }
    return prefixName + "-" + (hashValue >>> 0).toString(36);
  };
  const record = (id, subject, title, content) => ({
    id, createdAt: iso, updatedAt: iso, type: "record", date, order: 0, subject, title,
    contentHtml: "<p>" + content + "</p>", assets: [], formulas: [], mistakeRefs: [], tags: [],
  });
  const point = (id, subject, name) => ({ id, createdAt: iso, updatedAt: iso, subject, name,
    normalizedKey: name.normalize("NFKC").trim().replace(/\\s+/g, " ").toLocaleLowerCase("zh-CN"),
    aliases: [], status: "active" });
  const sourceFingerprint = (item) => hash([item.id, item.subject, item.title, item.contentHtml, item.updatedAt], "kp-record-v1");
  const stores = ["blocks", "recordReviews", "knowledgePoints", "recordKnowledgePointLinks", "learningEvidence", "aiSessions", "learningCoachSettings"];
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("study-journal-408");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const tx = db.transaction(stores, "readwrite");
  const tables = Object.fromEntries(stores.map((name) => [name, tx.objectStore(name)]));
  for (const store of [tables.blocks, tables.recordReviews, tables.knowledgePoints, tables.recordKnowledgePointLinks, tables.learningEvidence, tables.aiSessions]) {
    await new Promise((resolve, reject) => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve();
        if (String(cursor.key).startsWith(prefix)) cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }
  const overdueRecord = record(prefix + "overdue-record", "OS", "进程调度：时间片轮转", "时间片轮转需要分析就绪队列与上下文切换开销。");
  const weakRecord = record(prefix + "weak-record", "计网", "IPv4：子网划分", "子网掩码用于划分网络位和主机位，需要重新推导 CIDR 前缀。");
  const overduePoint = point(prefix + "overdue-point", "OS", "时间片轮转调度");
  const weakPoint = point(prefix + "weak-point", "计网", "IPv4 子网划分");
  const link = (id, recordId, pointId, item) => ({ id, createdAt: iso, updatedAt: iso, recordId, knowledgePointId: pointId,
    role: "primary", sourceQuote: item.title, recordFingerprint: sourceFingerprint(item), confirmationSource: "manual", confirmedAt: iso, status: "active" });
  const overdueReview = { id: overdueRecord.id, recordId: overdueRecord.id, createdAt: iso, updatedAt: iso, status: "active",
    easeFactor: 2.5, repetition: 1, intervalDays: 1, nextReviewDate: previousDate, consecutiveRemembered: 0, totalReviews: 0 };
  const quizSession = { id: prefix + "quiz-session", createdAt: iso, updatedAt: iso, title: "Phase 2 fixture confirmed assessment", sourceDate: date,
    coachQuiz: { knowledgePointId: weakPoint.id, recordIds: [weakRecord.id], contextFingerprint: sourceFingerprint(weakRecord), assessment: { assistantMessageId: prefix + "assessment-message", status: "accepted", suggestedOutcome: "needs-review" } } };
  const assessment = { id: prefix + "needs-review-assessment", createdAt: iso, updatedAt: iso, date, occurredAt: iso,
    subject: "计网", kind: "quiz-assessment-confirmed", origin: "user-confirmed-ai", source: { type: "ai-session", id: quizSession.id },
    target: { type: "knowledge-point", id: weakPoint.id }, payload: { outcome: "needs-review" } };
  for (const [store, value] of [[tables.blocks, overdueRecord], [tables.blocks, weakRecord], [tables.knowledgePoints, overduePoint], [tables.knowledgePoints, weakPoint],
    [tables.recordKnowledgePointLinks, link(prefix + "overdue-link", overdueRecord.id, overduePoint.id, overdueRecord)], [tables.recordKnowledgePointLinks, link(prefix + "weak-link", weakRecord.id, weakPoint.id, weakRecord)],
    [tables.recordReviews, overdueReview], [tables.aiSessions, quizSession], [tables.learningEvidence, assessment]]) {
    store.put(value);
  }
  const settings = await new Promise((resolve, reject) => { const request = tables.learningCoachSettings.get("learning-coach"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  tables.learningCoachSettings.put({ ...(settings ?? {}), id: "learning-coach", scenario: "postgraduate-exam", dashboardEnabled: true, updatedAt: iso });
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
  db.close();
  return { date, previousDate, overdueRecordId: overdueRecord.id, overduePointId: overduePoint.id, weakRecordId: weakRecord.id, weakPointId: weakPoint.id, assessmentId: assessment.id };
})()`);
console.log(JSON.stringify(result, null, 2));
if (process.env.PHASE2_AI_KEY?.trim()) {
  const apiKey = JSON.stringify(process.env.PHASE2_AI_KEY.trim());
  await evaluate(`(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("study-journal-408"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction(["settings", "aiSecrets"], "readwrite");
    const settingsStore = tx.objectStore("settings");
    const settings = await new Promise((resolve, reject) => { const request = settingsStore.get("settings"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const current = settings?.ai ?? {};
    const provider = { id: "phase2-aifafa", providerName: "Phase 2 临时 AI", baseUrl: "https://api.aifafa.co", model: "gpt-5.6-terra", temperature: 0.2, maxTokens: 1200, contextWindowTokens: 32768, memoryTurns: 4 };
    settingsStore.put({ ...settings, id: "settings", ai: { ...current, currentProviderId: provider.id, providers: [provider], presets: current.presets ?? [], imageInputMode: current.imageInputMode ?? "local-ocr" } });
    tx.objectStore("aiSecrets").put({ id: provider.id, apiKey: ${apiKey}, updatedAt: new Date().toISOString() });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
    db.close();
    return true;
  })()`);
  console.log("Temporary AI provider configured in the disposable profile.");
}
socket.close();
