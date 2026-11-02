import { ActivityIndicator, Pressable, StyleSheet, type ViewStyle } from "react-native";

import { Text, useThemeColor } from "@/components/Themed";

type Variant = "primary" | "secondary" | "danger" | "ghost";

type AppButtonProps = {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
};

const VARIANTS: Record<Variant, { background: string; text: string; border?: string }> = {
  primary: { background: "#0F5132", text: "#FFFFFF" },
  secondary: { background: "#E7F2EC", text: "#0F5132" },
  danger: { background: "#B42318", text: "#FFFFFF" },
  ghost: { background: "transparent", text: "#0F5132" }
};

export function AppButton({
  title,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  style
}: AppButtonProps) {
  const scheme = useThemeColor({}, "text") === "#fff" ? "dark" : "light";
  const palette = VARIANTS[variant];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: palette.background,
          borderColor: palette.border ?? palette.background,
          opacity: isDisabled ? 0.5 : pressed ? 0.8 : 1
        },
        scheme === "dark" && variant === "secondary"
          ? { backgroundColor: "#153A2A" }
          : null,
        style
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.text} />
      ) : (
        <Text style={[styles.label, { color: palette.text }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 12
  },
  label: {
    fontSize: 16,
    fontWeight: "600"
  }
});

