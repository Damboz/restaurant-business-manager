import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@rbm/shared';

import { Text, View } from '@/components/Themed';
import { AppButton } from '@/src/components/AppButton';
import { Chip } from '@/src/components/Chip';
import { Screen } from '@/src/components/Screen';
import { Card, ErrorBanner, LoadingBlock, Row } from '@/src/components/ui';
import { getReportSummary, type ReportSummary } from '@/src/api/business';
import { useAuth } from '@/src/auth/AuthProvider';
import { useRestaurantId } from '@/src/hooks/useRestaurantId';
import { startOfMonth, todayDateOnly } from '@/src/utils/date';

type Period = 'today' | 'month';

export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const restaurantId = useRestaurantId();
  const {
    user,
    activeMembership,
    selectRestaurant,
    signOut,
  } = useAuth();
  const [period, setPeriod] = useState<Period>('today');
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currency = activeMembership?.restaurant.currency ?? 'MWK';

  const load = useCallback(async () => {
    if (!restaurantId) return;

    const today = todayDateOnly();
    setLoading(true);
    setError(null);

    try {
      setSummary(
        await getReportSummary(restaurantId, {
          startDate: period === 'month' ? startOfMonth(today) : today,
          endDate: today,
        })
      );
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }, [restaurantId, period]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!user) return null;

  if (!activeMembership) {
    return (
      <Screen>
        <Text style={styles.noRestaurant}>{t('dashboard.noRestaurant')}</Text>
        <AppButton
          title={t('settings.logout')}
          variant="secondary"
          onPress={() => void signOut()}
        />
      </Screen>
    );
  }

  const money = (value: string | undefined) =>
    formatMoney(BigInt(value ?? '0'), currency);

  const salesMinor = BigInt(summary?.sales.totalMinor ?? '0');
  const purchasesMinor = BigInt(summary?.expenses.totalMinor ?? '0');
  const profitMinor = salesMinor - purchasesMinor;
  const isLoss = profitMinor < 0n;

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.greeting}>
          {t('dashboard.welcomeBack', { name: user.fullName.split(' ')[0] })}
        </Text>
        <Text style={styles.restaurant}>{activeMembership.restaurant.name}</Text>
      </View>

      {user.memberships.length > 1 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('dashboard.switchRestaurant')}</Text>
          <View style={styles.chips}>
            {user.memberships.map((membership) => (
              <Chip
                key={membership.id}
                label={membership.restaurant.name}
                selected={membership.id === activeMembership.id}
                onPress={() => void selectRestaurant(membership.id)}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.chips}>
        <Chip
          label={t('common.today')}
          selected={period === 'today'}
          onPress={() => setPeriod('today')}
        />
        <Chip
          label={t('common.month')}
          selected={period === 'month'}
          onPress={() => setPeriod('month')}
        />
      </View>

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingBlock label={t('common.loading')} /> : null}

      {!loading && summary ? (
        <>
          <Card>
            <Text style={styles.resultLabel}>
              {isLoss ? t('dashboard.loss') : t('dashboard.profit')}
            </Text>
            <Text style={[styles.result, isLoss && styles.loss]}>
              {money(profitMinor.toString())}
            </Text>
          </Card>

          <Card>
            <Row label={t('reports.sales')} value={money(salesMinor.toString())} />
            <Row
              label={t('nav.purchases')}
              value={money(purchasesMinor.toString())}
            />
          </Card>
        </>
      ) : null}

      <View style={styles.actions}>
        <AppButton
          title={t('dashboard.recordSale')}
          onPress={() => router.push('/sales')}
        />
        <AppButton
          title={t('dashboard.addPurchase')}
          variant="secondary"
          onPress={() => router.push('/purchases')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: 20,
  },
  greeting: {
    fontSize: 26,
    fontWeight: '800',
  },
  restaurant: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: '700',
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  resultLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    opacity: 0.6,
    marginBottom: 8,
  },
  result: {
    fontSize: 34,
    fontWeight: '800',
    color: '#0F5132',
  },
  loss: {
    color: '#B42318',
  },
  actions: {
    gap: 10,
    marginTop: 4,
  },
  noRestaurant: {
    fontSize: 16,
    marginBottom: 16,
  },
});
