import { expect, it } from "vite-plus/test";
import { withExclusiveUpdatePrompt } from "./updatePrompt";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve: () => resolve() };
}

it("allows only one confirmation at a time and releases it after cancellation", async () => {
  const entered = deferred();
  const release = deferred();
  const name = "t3code:test-update-confirmation";
  const first = withExclusiveUpdatePrompt(async () => {
    entered.resolve();
    await release.promise;
  }, name);
  await entered.promise;
  let duplicate = false;
  expect(
    await withExclusiveUpdatePrompt(async () => {
      duplicate = true;
    }, name),
  ).toBe(false);
  expect(duplicate).toBe(false);
  release.resolve();
  expect(await first).toBe(true);
  expect(await withExclusiveUpdatePrompt(async () => {}, name)).toBe(true);
});
