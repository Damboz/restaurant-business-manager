import { Pressable, StyleSheet } from "react-native";

import { Text, useThemeColor } from "@/components/Themed";

type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
};

export function Chip({ label, selected = false, onPress }: ChipProps) {
  const isDark = useThemeColor({}, "text") === "#fff";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected
            ? "#0F5132"
            : isDark
              ? "#1C1C1E"
              : "#F2F4F7",
          borderColor: selected ? "#0F5132" : isDark ? "#3A3A3C" : "#D0D5DD",
          opacity: pressed ? 0.75 : 1
        }
      ]}
    >
      <Text
        style={[
          styles.label,
          { color: selected ? "#FFFFFF" : isDark ? "#FFFFFF" : "#344054" }
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8
  },
  label: {
    fontSize: 14,
    fontWeight: "600"
  }
});

