import { expect, test } from "@playwright/test";

test.setTimeout(60_000);

const assertNoHorizontalOverflow = async (page: import("@playwright/test").Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
};

for (const theme of ["reading", "modern"] as const) {
  test(`stage 3 formal editor preserves draft, source navigation and layout in ${theme}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      const knownTiptapDevWarning = text.startsWith("Warning: flushSync was called from inside a lifecycle method.");
      if (message.type() === "error" && !knownTiptapDevWarning) errors.push(text);
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), ["study-journal-visual-theme-v1", theme]);

    await page.goto("/?preview=stage3");
    await page.getByRole("button", { name: /BFS Stage3 Preview/ }).first().click();
    await expect(page.getByRole("heading", { name: "BFS Stage3 Preview" })).toBeVisible();
    await expect(page.getByRole("button", { name: "编辑", exact: true })).toBeVisible();
    await page.waitForTimeout(300);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`stage3-reading-${theme}.png`), fullPage: true });

    await page.getByRole("button", { name: "编辑", exact: true }).click();
    const title = page.getByRole("textbox", { name: "记录标题" });
    await title.fill("BFS 中 visited 标记时机、重复入队与 predecessor 稳定性的完整推导");
    const editor = page.locator(".rich-editor[contenteditable='true']");
    await expect(editor).toBeVisible();
    const mobileMoreTools = page.getByRole("button", { name: "展开更多编辑工具" });
    const codeLanguage = page.getByRole("combobox", { name: "代码块语言" });
    if (testInfo.project.name === "android-narrow") {
      await expect(mobileMoreTools).toBeVisible();
      await expect(codeLanguage).toBeHidden();
      await mobileMoreTools.click();
      await expect(codeLanguage).toBeVisible();
      await expect(page.getByTitle("图片")).toBeVisible();
    } else {
      await expect(mobileMoreTools).toBeHidden();
      await expect(codeLanguage).toBeVisible();
    }
    await assertNoHorizontalOverflow(page);
    await editor.fill("在 BFS 中，一个节点可能同时与多个已经访问到的父节点相邻。\n\n首次发现时必须先标记 visited，再加入队列，并同时记录 predecessor。\n\n这条不变量保证每个节点最多入队一次，也保证首次发现路径不会被后续父节点覆盖。");
    await expect(page.getByText(/本机草稿/)).toBeVisible();
    await page.locator("html").evaluate((element) => element.style.setProperty("--font-scale", "1.25"));
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`stage3-editor-${theme}.png`), fullPage: true });

    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("heading", { name: /BFS 中 visited/ })).toBeVisible();
    await expect(page.getByText("正式内容已保存", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await expect(page.getByRole("heading", { name: "今天想记下什么？" })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}
