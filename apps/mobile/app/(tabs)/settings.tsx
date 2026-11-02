import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text, View } from '@/components/Themed';
import { updateProfile } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { Chip } from '@/src/components/Chip';
import { Screen } from '@/src/components/Screen';
import { useLanguage } from '@/src/i18n/LanguageProvider';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { language, setLanguage } = useLanguage();
  const {
    user,
    activeMembership,
    hasPermission,
    signOut,
    refreshUser,
  } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  if (!user) {
    return null;
  }

  if (!activeMembership) {
    return (
      <Screen>
        <Text style={styles.bannerText}>{t('dashboard.noRestaurant')}</Text>
        <AppButton
          title={t('settings.logout')}
          variant="danger"
          loading={signingOut}
          onPress={() => void handleSignOut()}
        />
      </Screen>
    );
  }

  const canViewTeam =
    hasPermission('employees.view') || hasPermission('employees.manage');

  async function changeLanguage(next: 'en' | 'ny') {
    await setLanguage(next);

    try {
      await updateProfile({ language: next });
      await refreshUser();
    } catch {
      // The language still applies locally for this session.
    }
  }

  async function handleSignOut() {
    setSigningOut(true);

    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <Screen>
      {user.mustChangePassword ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{t('auth.temporaryPasswordNotice')}</Text>
          <AppButton
            title={t('auth.changePassword')}
            variant="secondary"
            onPress={() => router.push('/change-password')}
          />
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('settings.profile')}</Text>
        <Text style={styles.name}>{user.fullName}</Text>
        <Text style={styles.detail}>{user.phone}</Text>
        {user.email ? <Text style={styles.detail}>{user.email}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('settings.restaurant')}</Text>
        <Text style={styles.name}>{activeMembership.restaurant.name}</Text>
        <Text style={styles.detail}>
          {t('settings.role')}: {activeMembership.role.name}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('settings.language')}</Text>
        <View style={styles.chips}>
          <Chip
            label={t('settings.english')}
            selected={language === 'en'}
            onPress={() => void changeLanguage('en')}
          />
          <Chip
            label={t('settings.chichewa')}
            selected={language === 'ny'}
            onPress={() => void changeLanguage('ny')}
          />
        </View>
      </View>

      <View style={styles.actions}>
        {canViewTeam ? (
          <AppButton
            title={t('settings.employees')}
            onPress={() => router.push('/employees')}
          />
        ) : null}

        <AppButton
          title={t('auth.changePassword')}
          variant="secondary"
          onPress={() => router.push('/change-password')}
        />

        <AppButton
          title={t('settings.logout')}
          variant="danger"
          loading={signingOut}
          onPress={() =>
            Alert.alert(t('settings.logout'), t('settings.logoutConfirm'), [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: t('settings.logout'),
                style: 'destructive',
                onPress: () => void handleSignOut(),
              },
            ])
          }
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#FFF6E5',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    marginBottom: 16,
  },
  bannerText: {
    color: '#7A4100',
    fontSize: 14,
    fontWeight: '600',
  },
  card: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    opacity: 0.6,
    marginBottom: 10,
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
  },
  detail: {
    marginTop: 4,
    fontSize: 14,
    opacity: 0.75,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actions: {
    gap: 10,
    marginTop: 8,
  },
});
