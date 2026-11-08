import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text, View } from '@/components/Themed';
import { AppButton } from '@/src/components/AppButton';
import { FormField } from '@/src/components/FormField';
import { Screen } from '@/src/components/Screen';
import { Card, ErrorBanner, LoadingBlock, Pill, Row } from '@/src/components/ui';
import {
  getSettings,
  updateSettings,
  type SettingsData,
} from '@/src/api/business';
import { useAuth } from '@/src/auth/AuthProvider';
import { useRestaurantId } from '@/src/hooks/useRestaurantId';

export default function RestaurantSettingsScreen() {
  const { t } = useTranslation();
  const restaurantId = useRestaurantId();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('settings.manage');
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [city, setCity] = useState('');
  const [openingDate, setOpeningDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!restaurantId) return;
    let active = true;
    setLoading(true);
    setError(null);

    getSettings(restaurantId)
      .then((data) => {
        if (!active) return;
        setSettings(data);
        setName(data.restaurant.name);
        setPhone(data.restaurant.phone ?? '');
        setEmail(data.restaurant.email ?? '');
        setAddressLine(data.restaurant.addressLine ?? '');
        setCity(data.restaurant.city ?? '');
        setOpeningDate(data.restaurant.openingDate ?? '');
      })
      .catch((loadError: Error) => {
        if (active) setError(loadError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [restaurantId]);

  async function save() {
    if (!restaurantId || !name.trim()) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const updated = await updateSettings(restaurantId, {
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        addressLine: addressLine.trim() || null,
        city: city.trim() || null,
        openingDate: openingDate.trim() || null,
      });
      setSettings(updated);
      setSaved(true);
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.title}>{t('settings.restaurantSettings')}</Text>

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingBlock label={t('common.loading')} /> : null}

      {!loading && settings ? (
        <>
          <Card>
            <Text style={styles.cardTitle}>{t('settings.restaurant')}</Text>
            <Row label={t('settings.name')} value={settings.restaurant.name} />
            <Row label={t('common.status')} value={settings.restaurant.status} />
            <Row label={t('settings.phone')} value={settings.restaurant.phone ?? t('common.none')} />
            <Row label={t('settings.email')} value={settings.restaurant.email ?? t('common.none')} />
            <Row label={t('settings.address')} value={settings.restaurant.addressLine ?? t('common.none')} />
            <Row label={t('settings.city')} value={settings.restaurant.city ?? t('common.none')} />
            <Row
              label={t('settings.openingDate')}
              value={settings.restaurant.openingDate ?? t('common.none')}
            />
          </Card>

          {canManage ? (
            <Card>
              <Text style={styles.cardTitle}>{t('common.edit')}</Text>
              <FormField label={t('settings.name')} value={name} onChangeText={setName} />
              <FormField
                label={t('settings.phone')}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
              />
              <FormField
                label={t('settings.email')}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <FormField
                label={t('settings.address')}
                value={addressLine}
                onChangeText={setAddressLine}
              />
              <FormField label={t('settings.city')} value={city} onChangeText={setCity} />
              <FormField
                label={`${t('settings.openingDate')} (YYYY-MM-DD)`}
                value={openingDate}
                onChangeText={setOpeningDate}
              />

              {saved ? (
                <Pill label={t('common.ok')} tone="positive" />
              ) : null}

              <AppButton
                title={t('settings.saveRestaurant')}
                loading={saving}
                disabled={!name.trim()}
                onPress={() => void save()}
              />
            </Card>
          ) : null}

          <Card>
            <Text style={styles.cardTitle}>{t('settings.paymentMethods')}</Text>
            {settings.paymentMethods.map((method) => (
              <Row
                key={method.id}
                label={method.name}
                value={
                  method.isActive ? t('common.active') : t('common.inactive')
                }
              />
            ))}
          </Card>

          <Card>
            <Text style={styles.cardTitle}>{t('settings.expenseCategories')}</Text>
            {settings.expenseCategories.map((category) => (
              <Row
                key={category.id}
                label={category.name}
                value={
                  category.isOperating
                    ? t('reports.operatingExpenses')
                    : t('reports.cogs')
                }
              />
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    opacity: 0.6,
    marginBottom: 8,
  },
});
