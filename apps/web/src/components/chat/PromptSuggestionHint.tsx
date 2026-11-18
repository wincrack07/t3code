import { useGT } from "gt-react";
import { Kbd } from "../ui/kbd";

/** Key hint after an empty-composer suggestion, with its place among several at the bar's edge. */
export function PromptSuggestionHint(props: {
  readonly position: { readonly index: number; readonly count: number } | null;
}) {
  const gt = useGT();
  return (
    <>
      <span className="ml-2 inline-flex align-[1px]">
        <Kbd variant="outline">⇥ Tab</Kbd>
      </span>
      {props.position ? (
        <span
          className="absolute top-0 right-0 text-2xs tabular-nums"
          aria-label={gt("Suggestion {index} of {count}", {
            index: props.position.index + 1,
            count: props.position.count,
          })}
        >
          {props.position.index + 1}/{props.position.count}
        </span>
      ) : null}
    </>
  );
}
