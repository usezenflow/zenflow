import type { Page } from "@playwright/test";

const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:8025";

/** The newest six-digit code Mailpit caught for `email`. */
async function latestOtp(email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/messages`);
    const body = (await res.json()) as { messages: { To: { Address: string }[]; Snippet: string; ID: string }[] };
    const message = body.messages.find((m) => m.To.some((to) => to.Address === email));
    const code = message?.Snippet.match(/\b(\d{6})\b/)?.[1];
    if (code) return code;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No OTP mail for ${email} in Mailpit`);
}

/** Signs in with an email OTP. Returns once the calendar is reachable. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.getByRole("button", { name: /send otp/i }).click();
  await page.locator('input[name="otp"]').fill(await latestOtp(email));
  await page.locator('input[name="otp"]').press("Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}
