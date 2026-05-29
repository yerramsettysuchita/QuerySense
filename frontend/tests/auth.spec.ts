import { test, expect } from "@playwright/test";

test.describe("Auth pages", () => {
  test("login page renders correctly", async ({ page }) => {
    await page.goto("/auth/login");
    await expect(page.locator("input[type='email']")).toBeVisible();
    await expect(page.locator("input[type='password']")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("signup page renders correctly", async ({ page }) => {
    await page.goto("/auth/signup");
    await expect(page.locator("input[type='email']")).toBeVisible();
    await expect(page.locator("input[type='password']")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign up|create account|get started/i })).toBeVisible();
  });

  test("login redirects to dashboard on success", async ({ page }) => {
    // Intercept the auth API call and return a fake token
    await page.route("**/api/v1/auth/login", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { token: "fake-test-token", user: { name: "Test", email: "test@example.com" }, workspace: { id: "ws-1", name: "Test WS" } },
        }),
      })
    );

    await page.goto("/auth/login");
    await page.fill("input[type='email']", "test@example.com");
    await page.fill("input[type='password']", "password123");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 5000 });
  });
});
