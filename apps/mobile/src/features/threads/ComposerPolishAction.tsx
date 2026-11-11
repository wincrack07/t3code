import { Pressable, View } from "react-native";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";

/** Runs `/polish` on the whole draft; sized like the dictation button beside it. */
export function ComposerPolishAction(props: {
  readonly size: "regular" | "large";
  readonly disabled: boolean;
  readonly running: boolean;
  readonly onPress: () => void;
}) {
  const { scale } = useAndroidControlSizing();
  return (
    <Pressable
      accessibilityLabel={props.running ? "Polishing prompt" : "Polish prompt"}
      accessibilityRole="button"
      accessibilityState={{ busy: props.running, disabled: props.disabled }}
      className="size-[44px] shrink-0 items-center justify-center active:opacity-70"
      disabled={props.disabled || props.running}
      onPress={props.onPress}
      style={{ opacity: props.disabled && !props.running ? 0.4 : 1 }}
    >
      <View className="size-[44px] items-center justify-center">
        {props.running ? (
          <AppActivityIndicator size="small" colorClassName="accent-icon-muted" />
        ) : (
          <SymbolView
            name="pencil"
            size={Math.round((props.size === "large" ? 24 : 20) * scale)}
            tintColorClassName="accent-icon"
            type="monochrome"
          />
        )}
      </View>
    </Pressable>
  );
}
