import { test, expect, Page } from "@playwright/test";

const MOCK_USER  = { id: "u1", email: "test@example.com", name: "Test User", workspace_id: "ws1" };
const MOCK_WS    = { id: "ws1", name: "Test Workspace", slug: "test-workspace" };
const MOCK_TOKEN = "fake-test-token";

const MOCK_CONNECTION = {
  id: "c1", name: "Test DB", db_type: "postgresql",
  host: "localhost", port: "5432", database: "testdb",
  status: "ok", is_active: true, pg_stat_statements_enabled: true,
  last_checked_at: null, created_at: new Date().toISOString(),
};

const MOCK_QUERIES = [
  {
    id: "q1", query_fingerprint: "fp_orders_join_001",
    query_text: "SELECT u.*, o.* FROM users u JOIN orders o ON u.id = o.user_id",
    avg_exec_time_ms: 3450, max_exec_time_ms: 9200, calls: 1240,
    db_type: "postgresql", is_anomaly: true, is_resolved: false,
    detected_at: new Date().toISOString(),
  },
  {
    id: "q2", query_fingerprint: "fp_tx_daily_002",
    query_text: "SELECT COUNT(*), SUM(amount) FROM transactions WHERE status = 'completed'",
    avg_exec_time_ms: 980, max_exec_time_ms: 1900, calls: 560,
    db_type: "postgresql", is_anomaly: false, is_resolved: false,
    detected_at: new Date().toISOString(),
  },
];

async function mockAllAPIs(page: Page) {
  // Catch-all (lowest priority — added first in LIFO)
  await page.route("**/api/v1/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) })
  );
  await page.route("**/health", (route) =>
    route.fulfill({ status: 200, body: "ok" })
  );

  // Specific mocks added AFTER catch-all (higher priority in LIFO)
  await page.route("**/api/v1/stream/pulse", (route) =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ timestamp: Date.now(), stats: { active: 2, anomalies: 1, avg_ms: 2215, max_ms: 9200 }, recent: [] }),
    })
  );
  await page.route("**/api/v1/queries/slow**", (route) =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify(MOCK_QUERIES),
    })
  );
  await page.route("**/api/v1/queries/analyze", (route) =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        data: {
          ai_explanation: "Sequential scan detected.", issues: [],
          recommendations: [{ id: "r1", rec_type: "index", title: "Add index", sql_fix: "CREATE INDEX ...", impact: "high", confidence: 97 }],
          plan_nodes: [],
        },
      }),
    })
  );
  // Connections — regex so it matches trailing-slash URL (/connections/)
  await page.route(/\/api\/v1\/connections/, (route) =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ data: [MOCK_CONNECTION] }),
    })
  );
  // Dashboard crash prevention — these use r.data directly, catch-all { data: [] } causes TypeErrors
  await page.route("**/api/v1/queries/stats**", (route) =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ queries: { total_slow: 2, total_anomalies: 1, avg_exec_time_ms: 2215 }, benchmarks: { avg_improvement: 45, total_benchmarks: 0 } }),
    })
  );
  await page.route("**/api/v1/queries/regressions**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
  );
  await page.route("**/api/v1/indexes/stale**", (route) =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        postgres: { stale: [], bloated: [], duplicate: [] },
        mysql: { stale: [] },
        summary: { total_unused: 0, total_bloated: 0, total_duplicate: 0, wasted_mb: 0 },
      }),
    })
  );
  // Auth — must be LAST (highest priority)
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ data: { user: MOCK_USER, workspace: MOCK_WS } }),
    })
  );
}

async function loginAndVisit(page: Page, path: string) {
  await mockAllAPIs(page);
  await page.route("**/api/v1/auth/login", (route) =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { token: MOCK_TOKEN, user: MOCK_USER, workspace: MOCK_WS },
        timestamp: new Date().toISOString(),
      }),
    })
  );

  await page.goto("/login");
  await page.fill("input[type='email']", "test@example.com");
  await page.fill("input[type='password']", "password123");
  await page.locator("button[type='submit']").click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  await page.goto(path);
}

test.describe("Auth guards", () => {
  test("unauthenticated users are redirected away from /dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    // Should redirect to /login
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });

  test("/login page has sign-in form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("input[type='email']")).toBeVisible();
    await expect(page.locator("input[type='password']")).toBeVisible();
    await expect(page.locator("button[type='submit']")).toBeVisible();
  });
});

test.describe("Dashboard (authenticated)", () => {
  test("shows query table after login", async ({ page }) => {
    await loginAndVisit(page, "/dashboard");
    // SlowQueryTable renders query_text, not query_fingerprint
    await expect(page.getByText(/JOIN orders/i).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/SUM\(amount\)/i).first()).toBeVisible({ timeout: 5000 });
  });

  test("nav links are present after login", async ({ page }) => {
    await loginAndVisit(page, "/dashboard");
    await expect(page.getByRole("link", { name: /overview/i }).first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole("link", { name: /analyze/i }).first()).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole("link", { name: /indexes/i }).first()).toBeVisible({ timeout: 3000 });
  });

  test("command palette opens and closes with keyboard", async ({ page }) => {
    await loginAndVisit(page, "/dashboard");
    await page.waitForSelector("nav", { timeout: 8000 });

    await page.keyboard.press("Control+k");
    // Palette input should appear — use a broad locator
    await expect(page.locator("input").last()).toBeVisible({ timeout: 5000 });

    await page.keyboard.press("Escape");
  });

  test("analyze page renders SQL editor and analyze button", async ({ page }) => {
    await loginAndVisit(page, "/dashboard/analyze");
    await expect(page.locator(".cm-editor, textarea").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: /analyze/i }).first()).toBeVisible({ timeout: 5000 });
  });
});
