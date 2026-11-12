import type { ReactNode } from "react";
import { sidebarRowColorStyle } from "../../sidebarColors";

export function createSidebarColorBlocks(items: ReactNode[]) {
  const blocks: { depth: number; id: string; color: string | null; items: ReactNode[] }[] = [];
  const append = (...nodes: ReactNode[]) => (blocks.at(-1)?.items ?? items).push(...nodes);
  const close = () => {
    const block = blocks.pop()!;
    append(
      <li
        key={`colour-block:${block.id}`}
        data-sidebar-colour-block=""
        data-sidebar-row-colour={block.color ?? undefined}
        style={sidebarRowColorStyle(block.color)}
        // The gap above a group sits outside its wash, so the header stays centred in it.
        // Groups stand further apart than the projects inside them; a nested group hugs its parent.
        className="mt-3 list-none first:mt-2 [[data-sidebar-group-header]+&]:mt-0"
      >
        <ul className="m-0 flow-root list-none p-0">{block.items}</ul>
      </li>,
    );
  };
  return {
    append,
    next(depth: number) {
      while (blocks.length > 0 && blocks.at(-1)!.depth >= depth) close();
    },
    open(depth: number, id: string, color: string | null) {
      blocks.push({ depth, id, color, items: [] });
    },
    finish() {
      while (blocks.length > 0) close();
    },
  };
}
