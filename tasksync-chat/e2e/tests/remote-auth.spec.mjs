import { expect, test } from "@playwright/test";

const expectPinMode = process.env.TASKSYNC_E2E_EXPECT_PIN;
const e2ePin = process.env.TASKSYNC_E2E_PIN || "";

function parseExpectPinMode() {
	if (expectPinMode === "true") return true;
	if (expectPinMode === "false") return false;
	return null;
}

async function fillPin(page, pin) {
	const digits = pin.slice(0, 6).split("");
	for (let i = 0; i < digits.length; i++) {
		await page.locator(".pin-digit").nth(i).fill(digits[i]);
	}
}

test("remote login page renders expected controls", async ({ page }) => {
	await page.goto("/");
	await expect(page).toHaveTitle(/TaskSync Remote/i);
	await expect(page.locator(".pin-digit").first()).toBeVisible();
	await expect(page.locator("#submit")).toBeVisible();
});

test("api auth behavior matches pin-mode expectation", async ({ request }) => {
	const response = await request.get("/api/files?query=readme");
	const mode = parseExpectPinMode();

	if (mode === true) {
		expect([401, 429]).toContain(response.status());
		return;
	}

	if (mode === false) {
		expect(response.status()).toBe(200);
		return;
	}

	expect([200, 401, 429]).toContain(response.status());
});

test("pin login succeeds when TASKSYNC_E2E_PIN is provided", async ({
	page,
}) => {
	test.skip(
		!/^\d{4,6}$/.test(e2ePin),
		"Set TASKSYNC_E2E_PIN=4..6 digit PIN to run this test",
	);

	await page.goto("/");
	await fillPin(page, e2ePin);
	await page.locator("#submit").click();

	await expect(page).toHaveURL(/\/app\.html$/i, { timeout: 15000 });
	await expect(page.locator(".remote-header-title")).toHaveText(/TaskSync/i, {
		timeout: 15000,
	});
});
