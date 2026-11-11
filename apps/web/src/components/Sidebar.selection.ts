import { prefersReducedMotion } from "@t3tools/client-runtime/reduced-motion";

const ACTIVE_ROW = '[data-sidebar-row][aria-current="page"]';
export const SIDEBAR_SELECTION_PILL_ATTRIBUTE = "data-sidebar-selection-pill";
const SLIDE_TIMING: KeyframeAnimationOptions = {
  duration: 120,
  easing: "cubic-bezier(0.32, 0.72, 0, 1)",
};

function findRow(list: HTMLElement, selector: string): HTMLElement | null {
  for (const row of list.querySelectorAll<HTMLElement>(selector)) {
    // Exiting row clones are aria-hidden copies and must not anchor the pill.
    if (!row.closest('[aria-hidden="true"]')) return row;
  }
  return null;
}

/**
 * Slides one shared pill from the previously selected row to the newly selected one.
 * Rows keep painting their own selected surface; the pill only exists for the 120ms slide,
 * so reorders, collapsed groups, scroll, and resize never need it repositioned.
 */
export function createSidebarSelectionSlide(list: HTMLUListElement) {
  const view = list.ownerDocument.defaultView;
  let selectedKey = findRow(list, ACTIVE_ROW)?.dataset.sidebarRow ?? null;
  let pill: HTMLElement | null = null;
  let animation: Animation | null = null;

  const stop = () => {
    animation?.cancel();
    animation = null;
    pill?.remove();
    pill = null;
    delete list.dataset.selectionSliding;
  };

  const slide = (from: HTMLElement, to: HTMLElement) => {
    const origin = list.getBoundingClientRect();
    const fromRect = from.getBoundingClientRect();
    const toRect = to.getBoundingClientRect();
    if (fromRect.height === 0 || toRect.height === 0 || toRect.width === 0) return;
    const surface = view?.getComputedStyle(to);
    if (!surface) return;
    const next = list.ownerDocument.createElement("li");
    next.setAttribute(SIDEBAR_SELECTION_PILL_ATTRIBUTE, "");
    next.setAttribute("aria-hidden", "true");
    Object.assign(next.style, {
      position: "absolute",
      top: `${toRect.top - origin.top}px`,
      left: `${toRect.left - origin.left}px`,
      width: `${toRect.width}px`,
      height: `${toRect.height}px`,
      margin: "0",
      listStyle: "none",
      pointerEvents: "none",
      transformOrigin: "top left",
      borderRadius: surface.borderRadius,
      backgroundColor: surface.backgroundColor,
      boxShadow: surface.boxShadow,
    });
    // First child, so the rows (positioned, later in order) paint their content above it.
    list.prepend(next);
    pill = next;
    list.dataset.selectionSliding = "";
    const dy = fromRect.top - toRect.top;
    const scaleY = fromRect.height / toRect.height;
    animation = next.animate(
      [
        { transform: `translateY(${dy}px) scaleY(${scaleY})` },
        { transform: "translateY(0px) scaleY(1)" },
      ],
      SLIDE_TIMING,
    );
    const current = animation;
    current.addEventListener(
      "finish",
      () => {
        if (animation === current) stop();
      },
      { once: true },
    );
  };

  const observer = new MutationObserver(() => {
    const active = findRow(list, ACTIVE_ROW);
    const nextKey = active?.dataset.sidebarRow ?? null;
    if (nextKey === selectedKey) return;
    const previousKey = selectedKey;
    selectedKey = nextKey;
    stop();
    if (active === null || previousKey === null || prefersReducedMotion()) return;
    const previous = findRow(list, `[data-sidebar-row="${CSS.escape(previousKey)}"]`);
    // The old row left the list (archived, filtered, or inside a collapsed group): no origin.
    if (previous === null) return;
    slide(previous, active);
  });
  // childList catches a selected row that mounts already current (an expanding group).
  observer.observe(list, { subtree: true, childList: true, attributeFilter: ["aria-current"] });

  return {
    dispose() {
      observer.disconnect();
      stop();
    },
  };
}
