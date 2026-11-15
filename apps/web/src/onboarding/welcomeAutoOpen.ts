// Set while setup is open only because the first-run gate opened it. The gate closes it again
// when later evidence shows the workspace is not new; pressing Start keeps it open.
let autoOpened = false;

export function markWelcomeAutoOpened(): void {
  autoOpened = true;
}

export function keepWelcomeOpen(): void {
  autoOpened = false;
}

export function claimAutoOpenedWelcome(): boolean {
  const claimed = autoOpened;
  autoOpened = false;
  return claimed;
}
