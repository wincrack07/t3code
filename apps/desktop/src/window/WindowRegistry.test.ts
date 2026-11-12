import { describe, expect, it } from "vite-plus/test";
import { WindowRegistry } from "./WindowRegistry.ts";

describe("WindowRegistry", () => {
  it("finds existing threads in focus order and allows an explicit duplicate once", () => {
    const registry = new WindowRegistry<{ id: number; isDestroyed(): boolean }>();
    const first = { id: 1, isDestroyed: () => false };
    const second = { id: 2, isDestroyed: () => false };
    registry.register(first);
    registry.register(second);
    registry.reportThreads(first, ["remote:thread"]);
    expect(registry.findThread("remote:thread", second.id)).toBe(first);
    registry.allowDuplicate(second, "remote:thread");
    expect(registry.findThread("remote:thread", second.id)).toBeUndefined();
    registry.reportThreads(second, ["remote:thread"]);
    registry.focus(first);
    expect(registry.findThread("remote:thread")).toBe(first);
    registry.remove(first);
    expect(registry.findThread("remote:thread")).toBe(second);
  });
  it("tracks creation, focus order, closure and the last app window", () => {
    const registry = new WindowRegistry<{ id: number; isDestroyed(): boolean }>();
    const first = { id: 1, isDestroyed: () => false };
    let destroyed = false;
    const second = { id: 2, isDestroyed: () => destroyed };
    registry.register(first);
    registry.register(second);
    expect(registry.current()).toBe(second);
    registry.focus(first);
    expect(registry.current()).toBe(first);
    registry.focus({ id: 3, isDestroyed: () => false });
    expect(registry.list()).toEqual([second, first]);
    registry.remove(first);
    expect(registry.current()).toBe(second);
    destroyed = true;
    expect(registry.current()).toBeUndefined();
    expect(registry.list()).toEqual([]);
    registry.remove(second);
  });
});
