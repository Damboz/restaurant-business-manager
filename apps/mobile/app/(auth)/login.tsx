import { Link } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet
} from "react-native";
import { useTranslation } from "react-i18next";

import { Text, View } from "@/components/Themed";
import { AppButton } from "@/src/components/AppButton";
import { Chip } from "@/src/components/Chip";
import { FormField } from "@/src/components/FormField";
import { Screen } from "@/src/components/Screen";
import { ApiError } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthProvider";
import { useLanguage } from "@/src/i18n/LanguageProvider";

export default function LoginScreen() {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
  const { signIn } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!identifier.trim() || !password) {
      setError(t("auth.enterCredentials"));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await signIn({ identifier: identifier.trim(), password });
    } catch (signInError) {
      if (signInError instanceof ApiError && signInError.statusCode === 401) {
        setError(t("auth.invalidCredentials"));
      } else {
        setError(
          signInError instanceof Error ? signInError.message : t("errors.generic")
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen contentStyle={styles.content}>
        <View style={styles.languageRow}>
          <Chip
            label={t("settings.english")}
            selected={language === "en"}
            onPress={() => void setLanguage("en")}
          />
          <Chip
            label={t("settings.chichewa")}
            selected={language === "ny"}
            onPress={() => void setLanguage("ny")}
          />
        </View>

        <View style={styles.header}>
          <Text style={styles.brand}>{t("app.name")}</Text>
          <Text style={styles.tagline}>{t("app.tagline")}</Text>
        </View>

        <View style={styles.form}>
          <FormField
            label={t("auth.phoneOrEmail")}
            value={identifier}
            onChangeText={setIdentifier}
            placeholder="0991 234 567"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
          />
          <FormField
            label={t("auth.password")}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            textContentType="password"
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <AppButton
            title={t("auth.login")}
            onPress={() => void handleSubmit()}
            loading={submitting}
          />

          <View style={styles.registerRow}>
            <Text style={styles.muted}>{t("auth.noAccount")}</Text>
            <Link href="/register" asChild>
              <Pressable>
                <Text style={styles.link}>{t("auth.register")}</Text>
              </Pressable>
            </Link>
          </View>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1
  },
  content: {
    justifyContent: "center",
    paddingHorizontal: 24
  },
  languageRow: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
    marginBottom: 24
  },
  header: {
    marginBottom: 32
  },
  brand: {
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.5
  },
  tagline: {
    marginTop: 8,
    fontSize: 16,
    opacity: 0.7
  },
  form: {
    gap: 2
  },
  error: {
    color: "#B42318",
    fontSize: 14,
    marginBottom: 12
  },
  registerRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginTop: 20
  },
  muted: {
    opacity: 0.7
  },
  link: {
    color: "#0F5132",
    fontWeight: "700"
  }
});
