import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet } from "react-native";

import { Text, useThemeColor, View } from "@/components/Themed";

export function Card({ children }: { children: ReactNode }) {
  const isDark = useThemeColor({}, "text") === "#fff";
  return (
    <View
      style={[
        styles.card,
        { borderColor: isDark ? "#2C2C2E" : "#E4E7EC" }
      ]}
    >
      {children}
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator />
      <Text style={styles.loadingText}>{label}</Text>
    </View>
  );
}

export function EmptyText({ children }: { children: ReactNode }) {
  return <Text style={styles.empty}>{children}</Text>;
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export function Pill({
  label,
  tone = "neutral"
}: {
  label: string;
  tone?: "neutral" | "positive" | "warning" | "danger";
}) {
  const backgrounds = {
    neutral: "#F2F4F7",
    positive: "#E7F2EC",
    warning: "#FFF6E5",
    danger: "#FDECEA"
  };
  const colors = {
    neutral: "#344054",
    positive: "#0F5132",
    warning: "#7A4100",
    danger: "#B42318"
  };

  return (
    <View style={[styles.pill, { backgroundColor: backgrounds[tone] }]}>
      <Text style={[styles.pillText, { color: colors[tone] }]}>{label}</Text>
    </View>
  );
}

export function Divider() {
  const isDark = useThemeColor({}, "text") === "#fff";
  return (
    <View
      style={[
        styles.divider,
        { backgroundColor: isDark ? "#2C2C2E" : "#EAECF0" }
      ]}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    opacity: 0.6,
    marginBottom: 10
  },
  errorBanner: {
    backgroundColor: "#FDECEA",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12
  },
  errorText: {
    color: "#B42318",
    fontSize: 14,
    fontWeight: "600"
  },
  loading: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    gap: 10
  },
  loadingText: {
    fontSize: 14,
    opacity: 0.6
  },
  empty: {
    fontSize: 14,
    opacity: 0.6,
    marginBottom: 12
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 6
  },
  rowLabel: {
    fontSize: 14,
    opacity: 0.65,
    flexShrink: 1
  },
  rowValue: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "right",
    flexShrink: 1
  },
  pill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  pillText: {
    fontSize: 12,
    fontWeight: "700"
  },
  divider: {
    height: 1,
    marginVertical: 12
  }
});
