import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { useLayoutEffect, useRef, type CSSProperties } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { ComposerHandleContext, useComposerHandleContext } from "../composerHandleContext";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useResizeDrag } from "../hooks/useResizeDrag";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import { useQuietThreadShell } from "../state/entities";
import { useThreadColumnsStore, openThreadInSplit, type ThreadColumn } from "../threadColumnsStore";
import { buildThreadRouteParams, type ThreadRouteTarget } from "../threadRoutes";
import {
  threadContextDropTargetProps,
  useThreadContextDrop,
  THREAD_COLUMN_DRAG_TYPE,
  previewThreadColumnDrop,
  endThreadContextDrag,
} from "./chat/threadContextDrag";
import { ThreadRouteView } from "./ThreadRouteView";
import { Button } from "./ui/button";
import { SidebarInset } from "./ui/sidebar";

function ColumnDivider({ column, next }: { column: ThreadColumn; next: ThreadColumn }) {
  const resize = (width: number, otherWidth: number) => {
    const store = useThreadColumnsStore.getState();
    store.resize(column.id, width);
    store.resize(next.id, otherWidth);
  };
  const { ref, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture } =
    useResizeDrag<HTMLDivElement>((event) => {
      const left = event.currentTarget.parentElement;
      const right = left?.nextElementSibling as HTMLElement | null;
      if (!left || !right) return null;
      const start = left.getBoundingClientRect().width;
      const total = start + right.getBoundingClientRect().width;
      const weight = column.width + next.width;
      const apply = (width: number) => {
        left.style.setProperty("--column-weight", String((width / total) * weight));
        right.style.setProperty("--column-weight", String(((total - width) / total) * weight));
      };
      return {
        width: start,
        edge: "right",
        bounds: { min: Math.min(280, total / 3), max: total - Math.min(280, total / 3) },
        resize(width) {
          apply(width);
          return width;
        },
        finish(width, moved) {
          if (moved) resize((width / total) * weight, ((total - width) / total) * weight);
        },
        cleanup(committed) {
          if (!committed) apply(start);
        },
      };
    });
  return (
    <div
      ref={ref}
      role="separator"
      aria-label="Resize thread columns"
      aria-orientation="vertical"
      tabIndex={0}
      className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none hover:bg-primary/20 focus-visible:bg-primary/20"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const total = column.width + next.width;
        const width = Math.max(
          total * 0.2,
          Math.min(total * 0.8, column.width + total * (event.key === "ArrowLeft" ? -0.05 : 0.05)),
        );
        resize(width, total - width);
      }}
    />
  );
}

function Column({
  column,
  active,
  multiple,
  next,
  background,
  target,
  full,
  narrow,
}: {
  full: boolean;
  narrow: boolean;
  target?: ThreadRouteTarget | undefined;
  column: ThreadColumn;
  active: boolean;
  multiple: boolean;
  next?: ThreadColumn | undefined;
  background: boolean;
}) {
  const title = useQuietThreadShell(column.threadRef)?.title ?? "Thread";
  const composer = useComposerHandleContext();
  const activate = () => useThreadColumnsStore.getState().activate(column.id);
  const dropRef = useRef<HTMLElement>(null);
  const side = () =>
    dropRef.current?.dataset.threadSplitSide === "left" ? ("left" as const) : ("right" as const);
  useThreadContextDrop(dropRef, column.threadRef.environmentId, column.id, (refs) => {
    for (const ref of refs) openThreadInSplit(ref, column.id, side());
  });
  return (
    <section
      ref={dropRef}
      {...(!narrow ? threadContextDropTargetProps() : {})}
      data-thread-column-id={column.id}
      onDragOver={(event) => {
        if (narrow || !event.dataTransfer.types.includes(THREAD_COLUMN_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        previewThreadColumnDrop({ x: event.clientX, y: event.clientY }, event.currentTarget);
      }}
      onDrop={(event) => {
        if (narrow || !event.dataTransfer.types.includes(THREAD_COLUMN_DRAG_TYPE)) return;
        event.preventDefault();
        previewThreadColumnDrop({ x: event.clientX, y: event.clientY }, event.currentTarget);
        useThreadColumnsStore
          .getState()
          .move(event.dataTransfer.getData(THREAD_COLUMN_DRAG_TYPE), column.id, side());
        endThreadContextDrag();
      }}
      aria-label={title}
      data-active-thread-column={active || undefined}
      className="group/column relative flex min-h-0 min-w-0 flex-col border-r border-border last:border-r-0"
      style={
        { flex: "var(--column-weight) 1 0%", "--column-weight": column.width } as CSSProperties
      }
      data-workspace-unavailable={!active || undefined}
      onPointerDownCapture={(event) => {
        if (!(event.target instanceof Element && event.target.closest("[data-close-column]")))
          activate();
      }}
      onFocusCapture={(event) => {
        if (!(event.target instanceof Element && event.target.closest("[data-close-column]")))
          activate();
      }}
    >
      {multiple ? (
        <div
          className={`flex h-8 shrink-0 items-center gap-2 border-b px-2 ${active ? "bg-accent" : "bg-muted/30"}`}
        >
          <button
            type="button"
            className="min-w-0 flex-1 cursor-grab truncate text-left text-xs active:cursor-grabbing"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(THREAD_COLUMN_DRAG_TYPE, column.id);
              const host = event.currentTarget.closest<HTMLElement>("[data-thread-columns]");
              if (host) host.dataset.columnReordering = "true";
            }}
            onDragEnd={(event) => {
              const host = event.currentTarget.closest<HTMLElement>("[data-thread-columns]");
              if (host) delete host.dataset.columnReordering;
              endThreadContextDrag();
            }}
            onClick={activate}
          >
            {title}
          </button>
          <Button
            data-close-column
            variant="ghost"
            size="icon-xs"
            aria-label={`Close column: ${title}`}
            onClick={(event) => {
              event.stopPropagation();
              useThreadColumnsStore.getState().close(column.id);
            }}
          >
            <XIcon />
          </Button>
        </div>
      ) : null}
      <ComposerHandleContext value={active ? composer : null}>
        <ThreadRouteView
          target={target ?? { kind: "server", threadRef: column.threadRef }}
          column
          inactive={!active}
          background={background}
        />
      </ComposerHandleContext>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-30 hidden w-1/2 border-2 border-primary bg-primary/15 group-data-[thread-context-over=true]/column:block group-data-[thread-split-side=right]/column:right-0 group-data-[thread-split-side=right]/column:left-auto"
      >
        {full ? (
          <span className="absolute inset-x-0 top-1/2 text-center text-xs group-data-[column-reordering=true]/columns:hidden">
            3 column limit · Drop an open thread to focus it
          </span>
        ) : null}
      </div>
      {next ? <ColumnDivider column={column} next={next} /> : null}
    </section>
  );
}

export function ThreadColumns({
  target,
  background,
}: {
  target: ThreadRouteTarget;
  background: boolean;
}) {
  const layout = useThreadColumnsStore();
  const narrow = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const navigate = useNavigate();
  const draftId = target.kind === "draft" ? target.draftId : null;
  const draftRef = useComposerDraftStore((state) =>
    draftId ? (state.getDraftSession(draftId) ?? state.getPromotedDraftRedirect(draftId)) : null,
  );
  const routeRef = target.kind === "server" ? target.threadRef : draftRef;
  const routeKey = target.kind === "server" ? scopedThreadKey(target.threadRef) : target.draftId;
  const lastRouteKey = useRef<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- synchronizes persisted column selection with external router navigation in both directions
  useLayoutEffect(() => {
    if (background) return;
    if (lastRouteKey.current !== routeKey) {
      lastRouteKey.current = routeKey;
      if (routeRef) useThreadColumnsStore.getState().navigate(routeRef);
      return;
    }
    const active = layout.columns.find((column) => column.id === layout.activeId);
    if (
      active &&
      (routeRef === null || scopedThreadKey(active.threadRef) !== scopedThreadKey(routeRef))
    ) {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(active.threadRef),
      });
    }
  }, [background, layout.activeId, layout.columns, navigate, routeKey, routeRef]);
  if (target.kind === "draft" && routeRef === null) {
    return <ThreadRouteView target={target} background={background} />;
  }
  const columns = narrow
    ? layout.columns.filter((column) => column.id === layout.activeId)
    : layout.columns;
  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden md:h-dvh" inert={background}>
      <div data-thread-columns className="group/columns flex min-h-0 flex-1">
        {columns.map((column, index) => (
          <Column
            key={column.id}
            column={column}
            full={layout.columns.length === 3}
            narrow={narrow || target.kind === "draft"}
            target={
              target.kind === "draft" &&
              routeRef &&
              scopedThreadKey(column.threadRef) === scopedThreadKey(routeRef)
                ? target
                : undefined
            }
            active={column.id === layout.activeId}
            multiple={columns.length > 1}
            next={columns[index + 1]}
            background={background}
          />
        ))}
      </div>
    </SidebarInset>
  );
}
