import { createContext } from "react";

export const HtmlRenderPromptContext = createContext<((text: string) => Promise<void>) | undefined>(
  undefined,
);
