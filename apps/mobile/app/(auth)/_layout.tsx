import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, StyleSheet } from "react-native";

import { View } from "@/components/Themed";
import { useAuth } from "@/src/auth/AuthProvider";

export default function AuthLayout() {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  if (status === "authenticated") {
    return <Redirect href="/" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center"
  }
});
