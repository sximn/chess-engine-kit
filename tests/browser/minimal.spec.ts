import { test, expect } from "@playwright/test";

test("minimal example handles analysis, input errors, terminal positions, cancellation and recovery", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://localhost:4177/minimal/");
  const analyze = page.getByRole("button", { name: "Analyze", exact: true });
  const status = page.getByRole("status");
  const output = page.locator("#result");
  await analyze.click();
  await expect(analyze).toBeEnabled();
  await expect(output).toContainText(/pawns|mates/);

  await page.locator("#fen").fill("bad FEN");
  await analyze.click();
  await expect(status).toContainText("INVALID_POSITION");

  await page.locator("#fen").fill("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1");
  await page.locator("#moves").fill("");
  await analyze.click();
  await expect(status).toHaveText("Game over");
  await expect(output).toContainText("white wins");

  await page
    .locator("#fen")
    .fill("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  // Trigger the actual Cancel button as soon as the UI exposes it, avoiding a
  // machine-speed race against this example's deliberately small search budget.
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>("#cancel")!;
    const observer = new MutationObserver(() => {
      if (!button.disabled) {
        observer.disconnect();
        button.click();
      }
    });
    observer.observe(button, {
      attributes: true,
      attributeFilter: ["disabled"],
    });
    document.querySelector<HTMLFormElement>("#analysis")!.requestSubmit();
  });
  await expect(status).toHaveText("Analysis cancelled");
  await analyze.click();
  await expect(analyze).toBeEnabled();
  await expect(output).toContainText(/pawns|mates/);
  expect(errors).toEqual([]);
});
