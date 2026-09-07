import { expect, test, type Page } from "@playwright/test";

const installDiagnostics = (page: Page) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error"
      && !message.text().startsWith("Failed to load resource:")
      && !message.text().startsWith("Warning: flushSync was called")) {
      errors.push(message.text());
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().startsWith("https://fonts.")) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
};

const expectNoHorizontalOverflow = async (page: Page) => {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
};

const mockDeepSeek = async (page: Page) => {
  await page.route("https://api.deepseek.com/**", async (route) => {
    const payload = route.request().postDataJSON() as { messages?: Array<{ content?: string }> };
    const prompt = payload.messages?.map((item) => item.content ?? "").join("\n") ?? "";
    const inputText = prompt.slice(prompt.lastIndexOf("\n{") + 1);
    let input: Record<string, unknown> = {};
    try { input = JSON.parse(inputText) as Record<string, unknown>; } catch { /* schema fallback below */ }

    let result: Record<string, unknown>;
    if (prompt.includes("按给定判据评估用户回答")) {
      const criteria = Array.isArray(input.answerCriteria) ? input.answerCriteria : [];
      result = { status: "ok", assessment: "correct", matchedCriteria: criteria, missingCriteria: [], rationale: "回答覆盖全部判据。" };
    } else if (prompt.includes("独立检查题目是否无解")) {
      result = { status: "ok", verdict: "pass", severeIssues: [], rationale: "题目条件完整。" };
    } else if (prompt.includes("请把用户对学习决策块的原始评论整理成结构化理解")) {
      result = {
        status: "ok",
        actionability: "needs_training",
        difficultyType: "procedure",
        stuckAt: "关键步骤的执行顺序",
        userHypothesis: "边界条件尚未稳定",
        preferredPractice: "variation",
        missingInformation: [],
        confidence: 0.84,
      };
    } else {
      const blueprint = input.blueprint as { evidence?: unknown[] } | undefined;
      result = {
        status: "ok",
        practiceType: "variation",
        answerMode: "unique",
        question: "请根据来源说明正确的边界规则。",
        answerCriteria: ["能准确说明来源中的关键规则"],
        sourceEvidence: blueprint?.evidence ?? [],
        hints: ["检查决策条件与执行顺序。"],
      };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-request-id": "stage9-browser-mock" },
      body: JSON.stringify({
        id: "stage9-browser-mock",
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }],
        usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
      }),
    });
  });
};

test.describe("Stage 9 Review Coach release path", () => {
  test("queues decision-block review feedback atomically", async ({ page }) => {
    const errors = installDiagnostics(page);
    await mockDeepSeek(page);
    await page.goto("/?preview=stage3");

    await page.getByRole("button", { name: "开始复习" }).click();
    await expect(page.getByRole("heading", { name: "BFS Stage3 Preview" })).toBeVisible();
    await page.getByRole("textbox", { name: "复习重点 1 本次评论" }).fill("阶段 9：首次发现时应立即标记，避免重复入队。");
    await page.getByRole("button", { name: /忘记了/ }).click();
    await page.getByRole("button", { name: /^复习/ }).first().click();
    await page.getByRole("button", { name: "学习助教", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: /阶段 9：首次发现时应立即标记/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test("restores the analysis and scheduling checkpoints", async ({ page }) => {
    const errors = installDiagnostics(page);
    await page.goto("/?preview=stage5");
    await page.getByRole("button", { name: /^复习/ }).first().click();
    await page.getByRole("button", { name: "学习助教", exact: true }).click();

    await expect(page.getByRole("heading", { name: "复习助教" })).toBeVisible();
    await expect(page.getByText("最近分析：部分完成")).toBeVisible();
    await expect(page.getByText("当前任务", { exact: true })).toBeVisible();
    await expect(page.getByText("等待中", { exact: true })).toBeVisible();
    await expect(page.getByText("已延期", { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test("commits an immediate answer and mastered outcome with deterministic AI", async ({ page }) => {
    const errors = installDiagnostics(page);
    await mockDeepSeek(page);
    await page.goto("/?preview=stage6");
    await page.getByRole("button", { name: /^复习/ }).first().click();
    await page.getByRole("button", { name: "学习助教", exact: true }).click();

    await page.getByRole("button", { name: "继续训练" }).click();
    await expect(page.getByRole("heading", { name: /BFS 中首次发现/ })).toBeVisible();
    await page.getByRole("textbox", { name: "你的回答" }).fill("先标记 visited 再入队，避免节点重复入队。");
    await page.getByRole("button", { name: "提交回答" }).click();
    await expect(page.getByText("回答正确", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "结束本次训练" }).click();
    await page.getByRole("button", { name: "已掌握" }).click();
    await expect(page.getByRole("heading", { name: "复习助教" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test("commits delayed verification independently from record FSRS", async ({ page }) => {
    const errors = installDiagnostics(page);
    await mockDeepSeek(page);
    await page.goto("/?preview=stage7");
    await page.getByRole("button", { name: /^复习/ }).first().click();
    await page.getByRole("button", { name: "学习助教", exact: true }).click();

    await page.getByRole("button", { name: "继续训练" }).click();
    await expect(page.getByText(/结果不会改写整条日志的 FSRS 日期/)).toBeVisible();
    await page.getByRole("button", { name: "结束本次训练" }).click();
    await page.getByRole("button", { name: "仍然掌握" }).click();
    await expect(page.getByRole("heading", { name: "复习助教" })).toBeVisible();
    await expect(page.getByText(/2 次样本/).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
});
