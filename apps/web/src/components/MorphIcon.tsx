import { MorphIcon as BaseMorphIcon, type MorphIconProps } from "morphicons/react";

import { useReducedMotion } from "~/hooks/useReducedMotion";

export function MorphIcon({ reducedMotion, ...props }: MorphIconProps) {
  const reduced = useReducedMotion();
  return (
    <BaseMorphIcon reducedMotion={reducedMotion ?? (reduced ? "always" : "never")} {...props} />
  );
}
