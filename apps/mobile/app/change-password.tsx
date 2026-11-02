import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text, View } from '@/components/Themed';
import { ApiError, changePassword } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { FormField } from '@/src/components/FormField';
import { Screen } from '@/src/components/Screen';

function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) {
    return {};
  }

  const result: Record<string, string> = {};

  for (const detail of error.details) {
    if (
      detail &&
      typeof detail === 'object' &&
      'field' in detail &&
      'message' in detail &&
      typeof detail.field === 'string' &&
      typeof detail.message === 'string'
    ) {
      result[detail.field] = detail.message;
    }
  }

  return result;
}

export default function ChangePasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { signOut } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setErrors({});
    setFormError(null);

    if (newPassword !== confirmPassword) {
      setErrors({ confirmPassword: t('auth.passwordsDoNotMatch') });
      return;
    }

    setSubmitting(true);

    try {
      await changePassword({ currentPassword, newPassword });

      try {
        await signOut();
      } finally {
        router.replace('/login');
      }
    } catch (error) {
      const details = fieldErrors(error);

      if (Object.keys(details).length > 0) {
        setErrors(details);
      } else {
        setFormError(error instanceof Error ? error.message : t('errors.generic'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>{t('auth.changePassword')}</Text>
        <Text style={styles.subtitle}>{t('auth.changePasswordHint')}</Text>
      </View>

      <FormField
        label={t('auth.currentPassword')}
        value={currentPassword}
        onChangeText={setCurrentPassword}
        secureTextEntry
        textContentType="password"
        error={errors.currentPassword}
      />
      <FormField
        label={t('auth.newPassword')}
        value={newPassword}
        onChangeText={setNewPassword}
        secureTextEntry
        textContentType="newPassword"
        error={errors.newPassword}
      />
      <FormField
        label={t('auth.confirmPassword')}
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        textContentType="newPassword"
        error={errors.confirmPassword}
      />

      {formError ? <Text style={styles.error}>{formError}</Text> : null}

      <AppButton
        title={t('common.save')}
        onPress={() => void handleSubmit()}
        loading={submitting}
      />
      <AppButton
        title={t('common.cancel')}
        variant="ghost"
        onPress={() => router.back()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 15,
    opacity: 0.7,
  },
  error: {
    color: '#B42318',
    fontSize: 14,
    marginBottom: 12,
  },
});
