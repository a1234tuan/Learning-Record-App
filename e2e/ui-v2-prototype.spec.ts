import { expect, test } from "@playwright/test";

test.setTimeout(60_000);

const assertNoPageOverflow = async (page: import("@playwright/test").Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
};

for (const theme of ["清爽现代", "温润阅读"] as const) {
test(`covers the six-screen UI v2 prototype and critical interaction states in ${theme}`, async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/?preview=ui-v2");
  await page.getByRole("button", { name: theme, exact: true }).click();
  await expect(page.locator(".ui-v2-prototype")).toHaveAttribute("data-theme", theme === "清爽现代" ? "modern" : "reading");
  await expect(page.getByRole("heading", { name: "今天想记下什么？" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("01-today.png"), fullPage: true });

  await page.getByRole("button", { name: "日志", exact: true }).click();
  await expect(page.getByRole("heading", { name: "日志资料库" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "数据结构" })).toBeVisible();
  const search = page.getByPlaceholder("搜索标题、正文、图片文字");
  await search.fill("visited");
  const otherTheme = theme === "清爽现代" ? "温润阅读" : "清爽现代";
  await page.getByRole("button", { name: otherTheme, exact: true }).click();
  await expect(search).toHaveValue("visited");
  await page.getByRole("button", { name: theme, exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("02-library.png"), fullPage: true });

  await page.locator(".uv2-library-main").first().click();
  await expect(page.getByRole("button", { name: "编辑", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByLabel("日志标题")).toBeVisible();
  await expect(page.getByText("草稿已存于本机")).toBeVisible();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("已保存到本机 · 尚未同步")).toBeVisible();
  const codeOverflow = await page.getByTestId("wide-code").evaluate((element) => ({
    local: element.scrollWidth > element.clientWidth,
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(codeOverflow.local).toBe(testInfo.project.name === "android-narrow");
  expect(codeOverflow.page).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("03-editor.png"), fullPage: true });
  await page.getByRole("button", { name: "返回日志" }).click();

  await page.getByRole("button", { name: "复习", exact: true }).click();
  await expect(page.getByRole("heading", { name: "为什么必须在节点入队时标记 visited？" })).toBeVisible();
  await page.getByRole("button", { name: "记录卡点" }).click();
  await page.getByLabel("这次卡在哪里？").fill("容易把标记时机记成出队时。 ");
  await page.screenshot({ path: testInfo.outputPath("04-review.png"), fullPage: true });
  await page.getByRole("button", { name: /记得/ }).click();
  await expect(page.getByText("评分已保存")).toBeVisible();

  await page.getByRole("button", { name: /生成一组针对性练习/ }).click();
  await expect(page.getByRole("heading", { name: "把卡点变成下一次练习" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /待分析/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("05-coach.png"), fullPage: true });
  await page.getByRole("tab", { name: "训练与验证" }).click();
  await page.getByRole("button", { name: /BFS 标记时机的变化题训练/ }).click();
  await expect(page.locator(".uv2-bottom-nav")).toBeHidden();
  await page.getByPlaceholder("用自己的话写下推理过程").fill("同一个节点会在首次出队前被多个父节点重复加入队列。 ");
  await page.getByRole("button", { name: /提交回答/ }).click();
  await expect(page.getByRole("heading", { name: "基本正确，因果关系还可以更完整" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("05b-answer-feedback.png"), fullPage: true });

  await page.getByRole("button", { name: "训练与验证" }).click();
  await page.getByRole("button", { name: "工具", exact: true }).click();
  await expect(page.getByRole("heading", { name: "工具" })).toBeVisible();
  await page.getByRole("button", { name: "打开设置" }).click();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await page.getByRole("button", { name: /云同步/ }).click();
  await expect(page.getByText("云同步未完成", { exact: true })).toBeVisible();
  await expect(page.getByText(/IndexedDB|Dexie/)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("06-settings-error.png"), fullPage: true });

  await assertNoPageOverflow(page);
  expect(errors).toEqual([]);
});
}
