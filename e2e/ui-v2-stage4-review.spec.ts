import { expect, test } from "@playwright/test";

test.setTimeout(60_000);

const assertNoHorizontalOverflow = async (page: import("@playwright/test").Page) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
};

for (const theme of ["reading", "modern"] as const) {
  test(`stage 4 exposes review coach and returns adaptive tasks to it in ${theme}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (message.type() === "error" && !text.startsWith("Warning: flushSync was called from inside a lifecycle method.")) errors.push(text);
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() === 401) errors.push(`HTTP 401 ${response.url()}`);
    });
    await page.route("https://api.deepseek.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "stage4-ui-mock",
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
            status: "ok",
            actionability: "needs_training",
            difficultyType: "procedure",
            stuckAt: "关键步骤的执行顺序",
            userHypothesis: "边界条件尚未稳定",
            preferredPractice: "variation",
            missingInformation: [],
            confidence: 0.84,
          }) } }],
          usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
        }),
      });
    });
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), ["study-journal-visual-theme-v1", theme]);

    await page.goto("/?preview=stage6");
    await page.getByRole("button", { name: /^复习/ }).first().click();
    await expect(page.getByRole("button", { name: "日志复习", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "学习助教", exact: true }).click();
    await expect(page.getByRole("heading", { name: "学习助教" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "复习助教" })).toBeVisible();
    await expect(page.getByText("进行中", { exact: true })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`stage4-coach-${theme}.png`), fullPage: true });

    await page.getByRole("button", { name: "继续训练" }).click();
    await expect(page.getByRole("heading", { name: /BFS 中首次发现/ })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "你的回答" })).toBeVisible();
    await expect(page.locator(".bottom-nav")).toBeHidden();
    await page.locator("html").evaluate((element) => element.style.setProperty("--font-scale", "1.25"));
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`stage4-adaptive-${theme}.png`), fullPage: true });

    await page.getByRole("button", { name: "返回", exact: true }).click();
    await expect(page.getByRole("heading", { name: "学习助教" })).toBeVisible();
    await expect(page.getByRole("button", { name: "学习助教", exact: true })).toHaveClass(/active/);
    await assertNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}
