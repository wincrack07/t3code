import { useEnvironmentScope } from "../../state/session";
import { useNavigation } from "@react-navigation/native";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { AuthOrchestrationOperateScope, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { htmlRenderFileName } from "@t3tools/shared/htmlRender";
import { useGT } from "gt-react-native";

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
  const gt = useGT();
  if (!cards?.length) return null;
  return {
    title: gt("Agent cards"),
    icon: "doc.on.doc",
    items: cards.map((card) => ({
      id: card.id,
      title: card.title,
      items: [
        {
          id: `${card.id}:open`,
          title: gt("Open card"),
          subtitle: card.updatedAt
            ? gt("Updated {date}", { date: new Date(card.updatedAt).toLocaleString() })
            : gt("Updated before card timestamps were recorded"),
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
          title: gt("Remove card"),
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
