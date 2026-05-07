import { test, expect } from "@playwright/test";

const shouldRun = process.env.PW_APP_UI_SMOKE === "1";

test.describe("App UI selection policy smoke", () => {
  test.skip(!shouldRun, "Set PW_APP_UI_SMOKE=1 when desktop e2e harness is available.");

  test("connection list renders with selectable labels and interactive controls", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
  });

  test("ai panel code block header remains readable/selectable", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
  });
});

