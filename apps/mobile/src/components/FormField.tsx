import {
  StyleSheet,
  TextInput,
  type TextInputProps
} from "react-native";

import { Text, useThemeColor, View } from "@/components/Themed";

type FormFieldProps = TextInputProps & {
  label: string;
  error?: string;
};

export function FormField({ label, error, style, ...inputProps }: FormFieldProps) {
  const textColor = useThemeColor({}, "text");
  const scheme = useThemeColor({}, "text") === "#fff" ? "dark" : "light";
  const borderColor = error ? "#B42318" : scheme === "dark" ? "#3A3A3C" : "#D0D5DD";
  const backgroundColor = scheme === "dark" ? "#1C1C1E" : "#FFFFFF";

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...inputProps}
        placeholderTextColor={scheme === "dark" ? "#8E8E93" : "#98A2B3"}
        style={[
          styles.input,
          { color: textColor, borderColor, backgroundColor },
          style
        ]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 14
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 6
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16
  },
  error: {
    marginTop: 6,
    color: "#B42318",
    fontSize: 13
  }
});

