import { useEnvironmentScope } from "../../state/session";
import { useNavigation } from "@react-navigation/native";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { AuthOrchestrationOperateScope, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { htmlRenderFileName } from "@t3tools/shared/htmlRender";

import type { AppBarMenu } from "../../components/ui/AppBar.types";
import { useThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

export function useThreadCardsMenu(environment: string, thread: string): AppBarMenu | null {
  const environmentId = EnvironmentId.make(environment);
  const threadId = ThreadId.make(thread);
  const cards = useThreadShell(scopeThreadRef(environmentId, threadId))?.pinnedHtmlCards;
  const navigation = useNavigation();
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata);
  const canRemove = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  if (!cards?.length) return null;
  return {
    title: "Agent cards",
    icon: "doc.on.doc",
    items: cards.map((card) => ({
      id: card.id,
      title: card.title,
      items: [
        {
          id: `${card.id}:open`,
          title: "Open card",
          subtitle: card.updatedAt
            ? `Updated ${new Date(card.updatedAt).toLocaleString()}`
            : "Updated before card timestamps were recorded",
          onPress: () =>
            navigation.navigate("ThreadAttachment", {
              environmentId,
              threadId,
              attachmentId: card.attachmentId,
              name: htmlRenderFileName(card.title),
              mimeType: "text/html",
              sizeBytes: "0",
              htmlRender: "1",
            }),
        },
        {
          id: `${card.id}:remove`,
          title: "Remove card",
          destructive: true,
          disabled: !canRemove,
          onPress: () => {
            void updateMetadata({ environmentId, input: { threadId, unpinHtmlCard: card.id } });
          },
        },
      ],
    })),
  };
}
