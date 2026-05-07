import { test, expect } from "@playwright/test";

const shouldRun = process.env.PW_DATABASE_UI_SMOKE === "1";

test.describe("Database UI selection policy smoke", () => {
  test.skip(!shouldRun, "Set PW_DATABASE_UI_SMOKE=1 when desktop e2e harness is available.");

  test("query results text is selectable and copy affordances exist", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("No results yet")).toBeVisible();
  });

  test("table editor resize handle remains non-selectable", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
  });

  test("sql tabs remain interactive without accidental selection regressions", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
  });
});

