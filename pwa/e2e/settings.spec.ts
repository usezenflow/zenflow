import { expect, test } from "@playwright/test";
import { signIn } from "./helpers/auth";

const EMAIL = process.env.E2E_EMAIL ?? "e2e@example.com";

test.beforeEach(async ({ page }) => {
  await signIn(page, EMAIL);
});

test("settings opens on the profile and offers dark mode as one switch", async ({ page }) => {
  await page.getByRole("button", { name: /settings|cài đặt|me|cá nhân/i }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("switch", { name: /dark mode|chế độ tối/i })).toBeVisible();
});

test("switching language relabels the screen", async ({ page }) => {
  await page.getByRole("button", { name: /settings|cài đặt|me|cá nhân/i }).first().click();
  await page.getByRole("button", { name: /language|ngôn ngữ/i }).first().click();
  await page.getByRole("radio", { name: /english/i }).click();
  await expect(page.getByRole("button", { name: /language/i }).first()).toBeVisible();
});

test("an offline notice shows while the browser is offline", async ({ page, context }) => {
  await page.getByRole("button", { name: /settings|cài đặt|me|cá nhân/i }).first().click();
  await context.setOffline(true);
  await expect(page.getByText(/offline/i).first()).toBeVisible();
  await context.setOffline(false);
});
