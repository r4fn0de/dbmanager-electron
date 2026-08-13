import { expect, test } from "@playwright/test";

const shouldRun = process.env.PW_TAB_REORDER_SMOKE === "1";
const PUSHLOG_TAB_NAME = /pushlog/i;
const SETTINGS_TAB_NAME = /Settings/i;

test.describe("Connection tab reorder", () => {
  if (!shouldRun) {
    return;
  }

  test("keeps the dragged tab under the pointer and clears drag feedback", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "connection-tabs",
        JSON.stringify({
          state: {
            activeTabId: null,
            tabs: [
              { id: "pushlog", name: "pushlog", provider: "direct" },
              { id: "__settings__", kind: "settings", name: "Settings" },
            ],
          },
          version: 0,
        })
      );
    });

    await page.goto("http://127.0.0.1:5173/");

    const source = page.getByRole("tab", { name: PUSHLOG_TAB_NAME });
    const target = page.getByRole("tab", { name: SETTINGS_TAB_NAME });
    await expect(source).toBeVisible();
    await expect(target).toBeVisible();

    const sourceBox = await source.boundingBox();
    if (!sourceBox) {
      throw new Error("Could not measure the source tab for drag test");
    }

    const targetBox = await target.boundingBox();
    if (!targetBox) {
      throw new Error("Could not measure the target tab for drag test");
    }

    const startX = sourceBox.x + sourceBox.width / 2;
    const centerY = sourceBox.y + sourceBox.height / 2;
    const releaseX = targetBox.x + targetBox.width + 24;
    await page.mouse.move(startX, centerY);
    await page.mouse.down();
    await page.mouse.move(releaseX, centerY, {
      steps: 8,
    });

    const draggedBox = await source.boundingBox();
    if (!draggedBox) {
      throw new Error("Could not measure the dragged tab after reordering");
    }
    const draggedCenterX = draggedBox.x + draggedBox.width / 2;
    expect(Math.abs(draggedCenterX - releaseX)).toBeLessThan(sourceBox.width);

    await page.mouse.up();

    await expect(page.getByRole("tab").first()).toContainText("Settings");
    await page.waitForTimeout(1200);

    const lingeringDragFeedback = await page
      .getByRole("tab")
      .evaluateAll((elements) =>
        elements
          .filter((element) => {
            const style = getComputedStyle(element);
            return style.cursor === "grabbing" || style.boxShadow !== "none";
          })
          .map((element) => element.textContent?.trim())
      );

    expect(lingeringDragFeedback).toEqual([]);
  });
});
