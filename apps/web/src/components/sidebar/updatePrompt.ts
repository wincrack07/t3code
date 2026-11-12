export async function withExclusiveUpdatePrompt(
  action: () => Promise<void>,
  name = "t3code:desktop-update-confirmation",
): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.locks) {
    await action();
    return true;
  }
  return navigator.locks.request(name, { ifAvailable: true }, async (lock) => {
    if (!lock) return false;
    await action();
    return true;
  });
}
