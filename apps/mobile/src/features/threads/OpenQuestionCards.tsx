import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  assembleOpenQuestionAnswers,
  openQuestionAnswer,
  openQuestionOptions,
  runOpenQuestions,
  type OpenQuestionDraft,
  type OpenQuestionDrafts,
} from "@t3tools/client-runtime/state/open-questions";
import {
  AuthOrchestrationOperateScope,
  CommandId,
  type EnvironmentId,
  MessageId,
  type OpenQuestion,
  type OpenQuestionsUpdate,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { cn } from "../../lib/cn";
import { uuidv4 } from "../../lib/uuid";
import { useThreadShell } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

/** Native copy of the web cards: questions the agent left under its final reply. */
export function OpenQuestionCards(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly runId: RunId;
}) {
  const shell = useThreadShell(scopeThreadRef(props.environmentId, props.threadId));
  const questions = runOpenQuestions(shell?.openQuestions, props.runId);
  if (questions.length === 0) return null;
  return <OpenQuestionCardList {...props} questions={questions} />;
}

function OpenQuestionCardList(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly questions: ReadonlyArray<OpenQuestion>;
}) {
  const canOperate = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: true,
  });
  const [drafts, setDrafts] = useState<OpenQuestionDrafts>({});
  const [sending, setSending] = useState(false);

  const setStatus = (openQuestions: OpenQuestionsUpdate) =>
    updateMetadata({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, openQuestions },
    });

  const open = props.questions.filter((question) => question.status === "open");
  const assembled = assembleOpenQuestionAnswers(props.questions, drafts);
  const answeredCount = assembled?.update.updates.length ?? 0;

  const send = async () => {
    if (assembled === null) return;
    setSending(true);
    const sent = await enqueueThreadOutboxMessage({
      environmentId: props.environmentId,
      threadId: props.threadId,
      messageId: MessageId.make(uuidv4()),
      commandId: CommandId.make(uuidv4()),
      text: assembled.text,
      attachments: [],
      dispatchMode: "queue",
      createdAt: new Date().toISOString(),
    }).then(
      () => true,
      () => false,
    );
    if (sent && (await setStatus(assembled.update))._tag === "Success") setDrafts({});
    setSending(false);
  };

  return (
    <View className="mt-2 gap-2" accessibilityLabel="Open questions">
      {props.questions.map((question, index) => (
        <OpenQuestionCard
          key={question.id}
          number={index + 1}
          question={question}
          draft={drafts[question.id]}
          interactive={canOperate && !sending}
          onDraftChange={(next) => setDrafts((current) => ({ ...current, [question.id]: next }))}
          onStatus={(status) =>
            void setStatus({ action: "set_status", updates: [{ id: question.id, status }] })
          }
        />
      ))}
      {canOperate && open.length > 0 ? (
        <View className="flex-row items-center justify-end gap-3">
          <Text className="font-sans text-xs text-foreground-muted">
            {answeredCount} of {open.length} answered
          </Text>
          <Button
            size="compact"
            tone="primary"
            label={answeredCount === 1 ? "Send 1 answer" : `Send ${answeredCount} answers`}
            disabled={answeredCount === 0}
            loading={sending}
            onPress={() => void send()}
          />
        </View>
      ) : null}
    </View>
  );
}

function OpenQuestionCard(props: {
  readonly number: number;
  readonly question: OpenQuestion;
  readonly draft: OpenQuestionDraft | undefined;
  readonly interactive: boolean;
  readonly onDraftChange: (draft: OpenQuestionDraft) => void;
  readonly onStatus: (status: "open" | "dismissed") => void;
}) {
  const { question, draft } = props;
  const isOpen = question.status === "open";
  const answered = question.status === "answered" || (isOpen && openQuestionAnswer(draft) !== null);
  return (
    <View
      className={cn(
        "gap-2 rounded-xl border bg-card px-3 py-2.5",
        answered ? "border-green-500" : "border-border",
      )}
    >
      <View className="flex-row items-start gap-2">
        <Text className="font-mono text-xs text-foreground-muted">{props.number}</Text>
        <Text
          className={cn(
            "flex-1 font-sans text-sm",
            isOpen ? "text-foreground" : "text-foreground-muted",
          )}
        >
          {question.text}
        </Text>
        {!isOpen ? (
          <Text className="font-sans text-xs text-foreground-muted">
            {question.status === "answered"
              ? "Answered"
              : question.status === "dismissed"
                ? "Dismissed"
                : "Resolved"}
          </Text>
        ) : null}
      </View>
      {isOpen && question.context ? (
        <Text className="font-sans text-xs text-foreground-muted">{question.context}</Text>
      ) : null}
      {question.status === "answered" && question.answer ? (
        <Text className="font-sans text-xs text-foreground-muted">→ {question.answer}</Text>
      ) : null}
      {props.interactive && isOpen ? (
        <>
          <View className="flex-row flex-wrap gap-1.5">
            {openQuestionOptions(question).map((suggestion) => (
              <Chip
                key={suggestion}
                size="small"
                label={suggestion}
                selected={!draft?.later && draft?.choice === suggestion}
                onPress={() =>
                  props.onDraftChange({
                    ...draft,
                    later: false,
                    choice: draft?.choice === suggestion ? undefined : suggestion,
                  })
                }
              />
            ))}
            <Chip
              size="small"
              label="Later"
              selected={draft?.later === true}
              onPress={() => props.onDraftChange({ ...draft, later: !draft?.later })}
            />
            <Chip size="small" label="Dismiss" onPress={() => props.onStatus("dismissed")} />
          </View>
          <TextInput
            accessibilityLabel={`Detail or custom answer for question ${props.number}`}
            placeholder="Add a detail or your own answer"
            value={draft?.detail ?? ""}
            editable={draft?.later !== true}
            onChangeText={(detail) => props.onDraftChange({ ...draft, detail })}
          />
        </>
      ) : null}
      {props.interactive && !isOpen ? (
        <Button size="compact" tone="text" label="Reopen" onPress={() => props.onStatus("open")} />
      ) : null}
    </View>
  );
}
