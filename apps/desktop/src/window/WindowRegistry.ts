export class WindowRegistry<W extends { readonly id: number; isDestroyed(): boolean }> {
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
    if (this.windows.get(window.id) === window) this.windows.delete(window.id);
  }

  list(): W[] {
    return [...this.windows.values()].filter((window) => !window.isDestroyed());
  }

  current(): W | undefined {
    return this.list().at(-1);
  }
}
