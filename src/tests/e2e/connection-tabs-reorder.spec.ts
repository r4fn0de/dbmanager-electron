import { expect, test } from "@playwright/test";

const shouldRun = process.env.PW_TAB_REORDER_SMOKE === "1";
const PUSHLOG_TAB_NAME = /pushlog/i;
const SETTINGS_TAB_NAME = /Settings/i;
const FIRST_TAB_NAME = /^first/i;
const THIRD_TAB_NAME = /^third/i;

test.describe("Connection tab reorder", () => {
  if (!shouldRun) {
    return;
  }

  test("does not leave tabs overlapping after crossing a neighbor", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "connection-tabs",
        JSON.stringify({
          state: {
            activeTabId: null,
            tabs: [
              { id: "first", name: "first", provider: "direct" },
              { id: "second", name: "second", provider: "direct" },
              { id: "third", name: "third", provider: "direct" },
            ],
          },
          version: 0,
        })
      );
    });

    await page.goto("http://127.0.0.1:5173/");

    const source = page.getByRole("tab", { name: FIRST_TAB_NAME });
    const target = page.getByRole("tab", { name: THIRD_TAB_NAME });
    await expect(source).toBeVisible();
    await expect(target).toBeVisible();

    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    if (!sourceBox || !targetBox) {
      throw new Error("Could not measure tabs for overlap test");
    }

    const centerY = sourceBox.y + sourceBox.height / 2;
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, centerY);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width + 32, centerY + 80, {
      steps: 10,
    });
    await page.waitForTimeout(150);

    const boxes = await page.getByRole("tab").evaluateAll((elements) =>
      elements
        .map((element) => {
          const { left, right } = element.getBoundingClientRect();
          return { left, right };
        })
        .sort((a, b) => a.left - b.left)
    );

    for (const [index, box] of boxes.entries()) {
      const next = boxes[index + 1];
      if (next) {
        expect(next.left - box.right).toBeGreaterThanOrEqual(-1);
      }
    }

    await page.mouse.up();
  });

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
    const releaseY = centerY + 80;
    await page.mouse.move(startX, centerY);
    await page.mouse.down();
    await page.mouse.move(releaseX, releaseY, {
      steps: 8,
    });

    const draggedBox = await source.boundingBox();
    if (!draggedBox) {
      throw new Error("Could not measure the dragged tab after reordering");
    }
    const draggedCenterX = draggedBox.x + draggedBox.width / 2;
    const draggedCenterY = draggedBox.y + draggedBox.height / 2;
    expect(Math.abs(draggedCenterX - releaseX)).toBeLessThan(sourceBox.width);
    expect(Math.abs(draggedCenterY - centerY)).toBeLessThan(2);

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
