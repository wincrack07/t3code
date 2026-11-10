import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { readColumnLayout, useThreadColumnsStore } from "./threadColumnsStore";

const ref = (id: string, environment = "local") =>
  scopeThreadRef(EnvironmentId.make(environment), ThreadId.make(id));
const setup = () => {
  useThreadColumnsStore.setState({ columns: [], activeId: null });
  return useThreadColumnsStore.getState();
};

describe("thread columns", () => {
  it("opens next to active, deduplicates by environment and thread, and caps at three", () => {
    const store = setup();
    store.navigate(ref("a"));
    store.open(ref("b"));
    store.open(ref("a"));
    store.open(ref("a", "remote"));
    expect(useThreadColumnsStore.getState().columns.map((c) => c.threadRef)).toEqual([
      ref("a"),
      ref("a", "remote"),
      ref("b"),
    ]);
    store.open(ref("c"));
    expect(useThreadColumnsStore.getState().columns).toHaveLength(3);
    store.open(ref("b"));
    expect(useThreadColumnsStore.getState().activeId).toBe("local:b");
  });

  it("inserts on the hovered side and reorders existing columns at the cap without changing selection or widths", () => {
    const store = setup();
    store.navigate(ref("a"));
    store.open(ref("b"), "local:a", "left");
    store.open(ref("c"), "local:a", "right");
    const order = () => useThreadColumnsStore.getState().columns.map((column) => column.id);
    expect(order()).toEqual(["local:b", "local:a", "local:c"]);
    store.resize("local:b", 1.5);
    store.move("local:b", "local:c", "right");
    expect(order()).toEqual(["local:a", "local:c", "local:b"]);
    expect(useThreadColumnsStore.getState().activeId).toBe("local:c");
    expect(useThreadColumnsStore.getState().columns[2]?.width).toBe(1.5);
    store.move("local:b", "local:a", "left");
    expect(order()).toEqual(["local:b", "local:a", "local:c"]);
    store.move("local:b", "local:b", "right");
    store.move("missing", "local:a", "left");
    expect(order()).toEqual(["local:b", "local:a", "local:c"]);
    store.open(ref("d"), "local:a", "left");
    expect(order()).toHaveLength(3);
    store.open(ref("b"), "local:c", "right");
    expect(order()).toEqual(["local:b", "local:a", "local:c"]);
    expect(useThreadColumnsStore.getState().activeId).toBe("local:b");
  });

  it("route navigation replaces the active slot or activates an existing column", () => {
    const store = setup();
    store.navigate(ref("a"));
    store.open(ref("b"));
    const slot = useThreadColumnsStore.getState().activeId;
    store.navigate(ref("c"));
    expect(useThreadColumnsStore.getState().columns[1]).toMatchObject({
      id: slot,
      threadRef: ref("c"),
    });
    store.navigate(ref("a"));
    expect(useThreadColumnsStore.getState().activeId).toBe("local:a");
    store.open(ref("b"));
    expect(new Set(useThreadColumnsStore.getState().columns.map((c) => c.id)).size).toBe(3);
  });

  it("closing active activates a neighbor; closing inactive preserves active and the final column stays open", () => {
    const store = setup();
    store.navigate(ref("a"));
    store.open(ref("b"));
    store.open(ref("c"));
    store.close("local:c");
    expect(useThreadColumnsStore.getState().activeId).toBe("local:b");
    store.close("local:a");
    expect(useThreadColumnsStore.getState().activeId).toBe("local:b");
    store.close("local:b");
    expect(useThreadColumnsStore.getState().columns).toHaveLength(1);
    store.open(ref("c"));
    store.activate("local:b");
    store.close("local:b");
    expect(useThreadColumnsStore.getState().activeId).toBe("local:c");
  });

  it("persists only ordered refs, slot ids, widths and selection, and validates restored data", async () => {
    const store = setup();
    store.navigate(ref("a"));
    store.open(ref("b"));
    store.resize("local:a", 1.5);
    const { storage, name } = useThreadColumnsStore.persist.getOptions();
    const persisted = await storage!.getItem(name!);
    expect(persisted?.state).toEqual({
      columns: [
        { id: "local:a", threadRef: ref("a"), width: 1.5 },
        { id: "local:b", threadRef: ref("b"), width: 1 },
      ],
      activeId: "local:b",
    });
    expect(readColumnLayout(persisted?.state)).toEqual(persisted?.state);
    expect(
      readColumnLayout({
        columns: [{ id: "bad", threadRef: ref("x"), width: -1 }],
        activeId: "bad",
      }),
    ).toEqual({ columns: [], activeId: null });
    expect(readColumnLayout(null)).toEqual({ columns: [], activeId: null });
    const columns = ["a", "a", "b", "c", "d"].map((id) => ({ id, threadRef: ref(id), width: 1 }));
    expect(readColumnLayout({ columns, activeId: "missing" })).toEqual({
      columns: [columns[0], columns[2], columns[3]],
      activeId: "a",
    });
  });
});
