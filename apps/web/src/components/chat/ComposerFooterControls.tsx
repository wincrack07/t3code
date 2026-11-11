import type { ModelSelection, ProviderInstanceId, RuntimeMode } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { type ComponentProps, memo, useId, useRef } from "react";

import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";
import { focusRequestedPermission, useComposerMenuProps } from "./composerEventScope";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";
import { resolveModelPickerSelectedModel } from "./ModelPickerContent";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { runtimeModeConfig } from "./runtimeModeConfig";
import { useComposerMenuState } from "./useComposerMenuState";

export type RuntimeModeOption = {
  mode: RuntimeMode;
  disabledReason?: string;
} & (typeof runtimeModeConfig)[RuntimeMode];
const supervisedRuntimeModeOption: RuntimeModeOption = {
  mode: "approval-required" as const,
  ...runtimeModeConfig["approval-required"],
};
export const ComposerFooterModeControls = memo(function ComposerFooterModeControls(props: {
  runtimeMode: RuntimeMode;
  runtimeModeOptions: ReadonlyArray<RuntimeModeOption>;
  size?: "sm" | "xs";
  hidden?: boolean;
  /** How the permissions chip shows: hidden while the thread matches the user's default. */
  accessDisplay?: "label" | "icon" | "hidden";
  /** Draw the icon in the label color, not muted (the mode differs from the user's default). */
  emphasized?: boolean;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const size = props.size ?? "sm";
  const accessDisplay = props.accessDisplay ?? "label";
  const composerFloatingLayerProps = useComposerMenuProps();
  const [open, setOpen] = useComposerMenuState(props.hidden);
  const permissionsChipRef = useRef<HTMLButtonElement>(null);
  const runtimeModeOption =
    props.runtimeModeOptions.find((option) => option.mode === props.runtimeMode) ??
    supervisedRuntimeModeOption;
  const RuntimeModeIcon = runtimeModeOption.icon;
  // The chip opens the same Permissions toggle used in the model picker and the overflow menu.
  const permissionsTooltip = `Permissions: ${runtimeModeOption.label}. ${runtimeModeOption.description}`;
  const permissionsChip = (
    <Menu
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) =>
        focusRequestedPermission(isOpen, permissionsChipRef.current)
      }
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <ComposerControl
                  ref={permissionsChipRef}
                  data-composer-shortcut="composer.mode"
                  size={size}
                  // Mirrors the model trigger's trailing pe-1 so the gaps on both sides of the chip match.
                  className="ps-1.5"
                  aria-label={`Permissions: ${runtimeModeOption.label}`}
                />
              }
            />
          }
        >
          <ComposerControlIcon
            icon={RuntimeModeIcon}
            size={size}
            // Match the label, not full foreground: the chip's presence already marks the mode.
            {...(props.emphasized ? { className: "text-current" } : {})}
          />
          <span
            data-composer-control-label
            className={accessDisplay === "icon" ? "sr-only" : undefined}
          >
            {runtimeModeOption.label}
          </span>
        </TooltipTrigger>
        <TooltipPopup side="top">{permissionsTooltip}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="start" {...composerFloatingLayerProps}>
        <ComposerPermissionsSection
          runtimeMode={props.runtimeMode}
          runtimeModeOptions={props.runtimeModeOptions}
          onRuntimeModeChange={props.onRuntimeModeChange}
        />
      </MenuPopup>
    </Menu>
  );

  return accessDisplay === "hidden" ? null : permissionsChip;
});

/**
 * Permission modes as a list: each row names the mode with a one-line description and the
 * current one carries a check. Rows are real menu radio items, so a pick closes the menu.
 * Lives inside a Menu: the permissions chip, the model picker, or the overflow menu.
 */
export function ComposerPermissionsSection(props: {
  runtimeMode: RuntimeMode;
  runtimeModeOptions: ReadonlyArray<RuntimeModeOption>;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const descriptionId = useId();
  return (
    <div data-composer-permissions className="grid w-72 gap-0.5">
      <div className="px-2 pt-1 pb-0.5 font-medium text-muted-foreground text-xs">
        Permissions · this thread
      </div>
      <MenuRadioGroup
        aria-label="Permissions"
        value={props.runtimeMode}
        onValueChange={(value: RuntimeMode) => {
          if (value !== props.runtimeMode) props.onRuntimeModeChange(value);
        }}
      >
        {props.runtimeModeOptions.map((option) => (
          <MenuRadioItem
            key={option.mode}
            value={option.mode}
            disabled={option.disabledReason !== undefined}
            label={option.label}
            aria-label={option.label}
            aria-describedby={`${descriptionId}-${option.mode}`}
            closeOnClick
          >
            <span className="flex items-start gap-3 py-0.5">
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-foreground">{option.label}</span>
                <span
                  id={`${descriptionId}-${option.mode}`}
                  className="text-muted-foreground text-xs leading-4"
                >
                  {option.disabledReason ?? option.description}
                </span>
              </span>
              <MenuRadioItemIndicator className="mt-0.5" />
            </span>
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </div>
  );
}

export const ComposerFooterPrimaryActions = memo(function ComposerFooterPrimaryActions(props: {
  children?: React.ReactNode;
  compact: boolean;
  canOperateThread: boolean;
  isPreparingWorktree: boolean;
  pendingAction: {
    questionIndex: number;
    isLastQuestion: boolean;
    canAdvance: boolean;
    isResponding: boolean;
    isComplete: boolean;
  } | null;
  isRunning: boolean;
  canInterrupt: boolean;
  runId: string | null;
  followUpBehavior: "queue" | "steer";
  canSteer: boolean;
  alternateShortcutLabel: string | null;
  voiceInputActive?: boolean;
  isSendBusy: boolean;
  sendDisabledReason: string | null;
  isEnvironmentUnavailable: boolean;
  hasSendableContent: boolean;
  canResume: boolean;
  preserveComposerFocusOnPointerDown?: boolean;
  isEditingQueuedMessage: boolean;
  onSubmitMessage: React.MouseEventHandler<HTMLButtonElement>;
  onResume: () => void;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  compactBeforeSendTokens: number | null;
  keepFullHistory: boolean;
}) {
  return (
    <>
      <ComposerPrimaryActions
        compact={props.compact}
        canOperateThread={props.canOperateThread}
        pendingAction={props.pendingAction}
        isRunning={props.isRunning}
        canInterrupt={props.canInterrupt}
        runId={props.runId}
        followUpBehavior={props.followUpBehavior}
        canSteer={props.canSteer}
        alternateShortcutLabel={props.alternateShortcutLabel}
        voiceInputActive={props.voiceInputActive ?? false}
        isSendBusy={props.isSendBusy}
        sendDisabledReason={props.sendDisabledReason}
        isEnvironmentUnavailable={props.isEnvironmentUnavailable}
        isPreparingWorktree={props.isPreparingWorktree}
        hasSendableContent={props.hasSendableContent}
        canResume={props.canResume}
        preserveComposerFocusOnPointerDown={props.preserveComposerFocusOnPointerDown ?? false}
        isEditingQueuedMessage={props.isEditingQueuedMessage}
        onSubmitMessage={props.onSubmitMessage}
        onResume={props.onResume}
        onPreviousPendingQuestion={props.onPreviousPendingQuestion}
        onInterrupt={props.onInterrupt}
        compactBeforeSendTokens={props.compactBeforeSendTokens}
        keepFullHistory={props.keepFullHistory}
      >
        {props.children}
      </ComposerPrimaryActions>
    </>
  );
});

/**
 * The composer's model picker. It owns the single- and multi-model selection
 * handlers so they are cached against the selection state, not rebuilt on
 * every ChatComposer render.
 */
export function ComposerModelPicker({
  multipleModelsEnabled,
  multipleModelSelections,
  onMultipleModelSelectionsChange,
  selectedModelSelection,
  onProviderModelSelect,
  ...pickerProps
}: Omit<
  ComponentProps<typeof ProviderModelPicker>,
  "selectedModels" | "onToggleModel" | "onInstanceModelChange"
> & {
  readonly multipleModelsEnabled: boolean;
  readonly multipleModelSelections: ReadonlyArray<ModelSelection> | null;
  readonly onMultipleModelSelectionsChange: (
    selections: ReadonlyArray<ModelSelection> | null,
  ) => void;
  readonly selectedModelSelection: ModelSelection;
  readonly onProviderModelSelect: (
    instanceId: ProviderInstanceId,
    model: string,
    options?: { focusComposer?: boolean },
  ) => void;
}) {
  const { instanceEntries, modelOptionsByInstance } = pickerProps;
  const toggleModel = (instanceId: ProviderInstanceId, model: string) => {
    const current = multipleModelSelections ?? [selectedModelSelection];
    const matchesModel = (selection: ModelSelection) => {
      if (selection.instanceId !== instanceId) return false;
      const entry = instanceEntries.find((entry) => entry.instanceId === selection.instanceId);
      const resolvedModel = resolveModelPickerSelectedModel({
        driverKind: entry?.driverKind,
        model: selection.model,
        options: modelOptionsByInstance?.get(selection.instanceId) ?? [],
      });
      return (resolvedModel?.slug ?? selection.model) === model;
    };
    const exists = current.some(matchesModel);
    const next = exists
      ? current.filter((selection) => !matchesModel(selection))
      : [...current, createModelSelection(instanceId, model)];
    if (next.length > 1) {
      onMultipleModelSelectionsChange(next);
    } else {
      onMultipleModelSelectionsChange(null);
      const remaining = next[0] ?? selectedModelSelection;
      onProviderModelSelect(remaining.instanceId, remaining.model, {
        focusComposer: false,
      });
    }
  };
  return (
    <ProviderModelPicker
      {...pickerProps}
      {...(multipleModelsEnabled
        ? {
            ...(multipleModelSelections !== null
              ? { selectedModels: multipleModelSelections }
              : {}),
            onToggleModel: toggleModel,
          }
        : {})}
      onInstanceModelChange={(instanceId, model) => {
        onMultipleModelSelectionsChange(null);
        onProviderModelSelect(instanceId, model);
      }}
    />
  );
}
