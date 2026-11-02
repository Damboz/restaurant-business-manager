import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";

import { Text, View } from "@/components/Themed";
import { ApiError } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthProvider";
import { AppButton } from "@/src/components/AppButton";
import { FormField } from "@/src/components/FormField";
import { Screen } from "@/src/components/Screen";
import { useLanguage } from "@/src/i18n/LanguageProvider";

function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) {
    return {};
  }

  const result: Record<string, string> = {};

  for (const detail of error.details) {
    if (
      detail &&
      typeof detail === "object" &&
      "field" in detail &&
      "message" in detail &&
      typeof detail.field === "string" &&
      typeof detail.message === "string"
    ) {
      result[detail.field] = detail.message;
    }
  }

  return result;
}

export default function RegisterScreen() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { signUp } = useAuth();
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [city, setCity] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    setErrors({});
    setFormError(null);

    try {
      await signUp({
        fullName: fullName.trim(),
        phone: phone.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        password,
        restaurantName: restaurantName.trim(),
        city: city.trim() || undefined,
        language
      });
    } catch (signUpError) {
      const details = fieldErrors(signUpError);

      if (Object.keys(details).length > 0) {
        setErrors(details);
      } else {
        setFormError(
          signUpError instanceof Error
            ? signUpError.message
            : t("errors.generic")
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
      <Screen>
        <View style={styles.header}>
          <Text style={styles.title}>{t("auth.createAccountTitle")}</Text>
          <Text style={styles.subtitle}>{t("auth.createAccountHint")}</Text>
        </View>

        <FormField
          label={t("auth.fullName")}
          value={fullName}
          onChangeText={setFullName}
          autoComplete="name"
          error={errors.fullName}
        />
        <FormField
          label={t("auth.phone")}
          value={phone}
          onChangeText={setPhone}
          placeholder="0991 234 567"
          keyboardType="phone-pad"
          autoComplete="tel"
          error={errors.phone}
        />
        <FormField
          label={`${t("auth.email")} (${t("common.optional")})`}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          error={errors.email}
        />
        <FormField
          label={t("auth.password")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="newPassword"
          error={errors.password}
        />

        <Text style={styles.sectionTitle}>{t("auth.restaurantDetails")}</Text>

        <FormField
          label={t("auth.restaurantName")}
          value={restaurantName}
          onChangeText={setRestaurantName}
          error={errors.restaurantName}
        />
        <FormField
          label={`${t("auth.city")} (${t("common.optional")})`}
          value={city}
          onChangeText={setCity}
          error={errors.city}
        />

        {formError ? <Text style={styles.error}>{formError}</Text> : null}

        <AppButton
          title={t("auth.register")}
          onPress={() => void handleSubmit()}
          loading={submitting}
        />

        <View style={styles.loginRow}>
          <Text style={styles.muted}>{t("auth.alreadyAccount")}</Text>
          <Pressable onPress={() => router.replace("/login")}>
            <Text style={styles.link}>{t("auth.login")}</Text>
          </Pressable>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1
  },
  header: {
    marginBottom: 24
  },
  title: {
    fontSize: 28,
    fontWeight: "800"
  },
  subtitle: {
    marginTop: 8,
    fontSize: 15,
    opacity: 0.7
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginTop: 10,
    marginBottom: 12
  },
  error: {
    color: "#B42318",
    fontSize: 14,
    marginBottom: 12
  },
  loginRow: {
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
