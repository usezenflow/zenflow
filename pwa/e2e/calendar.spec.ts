import { expect, test } from "@playwright/test";
import { signIn } from "./helpers/auth";

const EMAIL = process.env.E2E_EMAIL ?? "e2e@example.com";

test.beforeEach(async ({ page }) => {
  await signIn(page, EMAIL);
});

test("opens the calendar and the week view", async ({ page }) => {
  await page.goto("/?view=week");
  await expect(page.getByRole("button", { name: /new session|tạo buổi/i }).first()).toBeVisible();
});

test("a draft plan appears in the agenda after scheduling", async ({ page }) => {
  await page.getByRole("button", { name: /new session|tạo buổi/i }).first().click();
  const title = `E2E plan ${Date.now()}`;
  await page.getByPlaceholder(/name this session|đặt tên/i).fill(title);
  await page.getByRole("button", { name: /schedule it|lên lịch/i }).click();
  await expect(page.getByText(title).first()).toBeVisible();
});

test("deleting a plan can be undone", async ({ page }) => {
  await page.getByRole("button", { name: /new session|tạo buổi/i }).first().click();
  const title = `E2E undo ${Date.now()}`;
  await page.getByPlaceholder(/name this session|đặt tên/i).fill(title);
  await page.getByRole("button", { name: /schedule it|lên lịch/i }).click();
  await expect(page.getByText(title).first()).toBeVisible();

  await page.getByText(title).first().click();
  await page.getByRole("button", { name: /delete session|xóa buổi/i }).click();
  await page.getByRole("button", { name: /undo|hoàn tác/i }).click();
  await expect(page.getByText(title).first()).toBeVisible();
});
