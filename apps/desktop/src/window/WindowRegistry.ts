export class WindowRegistry<W extends { readonly id: number; isDestroyed(): boolean }> {
  private readonly threads = new Map<number, ReadonlySet<string>>();
  private readonly duplicates = new Map<number, string>();
  private readonly windows = new Map<number, W>();

  register(window: W): void {
    this.windows.set(window.id, window);
  }

  focus(window: W): void {
    if (!this.windows.has(window.id) || window.isDestroyed()) return;
    this.windows.delete(window.id);
    this.windows.set(window.id, window);
  }

  remove(window: W): void {
    if (this.windows.get(window.id) === window) {
      this.windows.delete(window.id);
      this.threads.delete(window.id);
      this.duplicates.delete(window.id);
    }
  }

  reportThreads(window: W, keys: readonly string[]): void {
    if (this.windows.has(window.id)) this.threads.set(window.id, new Set(keys));
  }

  allowDuplicate(window: W, key: string): void {
    this.duplicates.set(window.id, key);
  }

  findThread(key: string, senderId?: number): W | undefined {
    if (senderId !== undefined && this.threads.get(senderId)?.has(key)) return undefined;
    if (senderId !== undefined && this.duplicates.get(senderId) === key) {
      this.duplicates.delete(senderId);
      return undefined;
    }
    return this.list()
      .reverse()
      .find((window) => window.id !== senderId && this.threads.get(window.id)?.has(key));
  }

  list(): W[] {
    return [...this.windows.values()].filter((window) => !window.isDestroyed());
  }

  current(): W | undefined {
    return this.list().at(-1);
  }
}
