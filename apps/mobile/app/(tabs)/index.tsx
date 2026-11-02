import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@rbm/shared';

import { Text, View } from '@/components/Themed';
import { AppButton } from '@/src/components/AppButton';
import { Chip } from '@/src/components/Chip';
import { Screen } from '@/src/components/Screen';
import { Card, ErrorBanner, LoadingBlock, Row } from '@/src/components/ui';
import { useAuth } from '@/src/auth/AuthProvider';
import { getDashboard, type DashboardData } from '@/src/api/business';

export default function DashboardScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const {
    user,
    activeMembership,
    hasPermission,
    selectRestaurant,
    signOut,
  } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const restaurantId = activeMembership?.restaurant.id;
  const currency = activeMembership?.restaurant.currency ?? 'MWK';

  useEffect(() => {
    if (!restaurantId) return;
    let active = true;
    setLoading(true);
    setError(null);

    getDashboard(restaurantId)
      .then((data) => {
        if (active) setDashboard(data);
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

  if (!user) return null;

  if (!activeMembership) {
    return (
      <Screen>
        <Text style={styles.greeting}>{t('dashboard.noRestaurant')}</Text>
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

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.greeting}>
          {t('dashboard.welcomeBack', { name: user.fullName.split(' ')[0] })}
        </Text>
        <Text style={styles.restaurant}>{activeMembership.restaurant.name}</Text>
        <Text style={styles.role}>{activeMembership.role.name}</Text>
        {dashboard ? (
          <Text style={styles.date}>{dashboard.today}</Text>
        ) : null}
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

      {error ? <ErrorBanner message={error} /> : null}
      {loading && !dashboard ? <LoadingBlock label={t('common.loading')} /> : null}

      {dashboard ? (
        <>
          <Card>
            <Text style={styles.cardTitle}>{t('dashboard.today')}</Text>
            <Row
              label={t('reports.sales')}
              value={money(dashboard.todaySummary.sales.totalMinor)}
            />
            <Row
              label={t('reports.expenses')}
              value={money(dashboard.todaySummary.expenses.totalMinor)}
            />
            <Row
              label={t('reports.netProfit')}
              value={money(dashboard.todaySummary.netProfitMinor)}
            />
            <Row
              label={t('reports.transactions')}
              value={String(dashboard.todaySummary.sales.transactionCount)}
            />
            <Row
              label={t('closings.status')}
              value={t(`closings.${dashboard.closing.status.toLowerCase()}`)}
            />
          </Card>

          <Card>
            <Text style={styles.cardTitle}>{t('dashboard.thisMonth')}</Text>
            <Row
              label={t('reports.sales')}
              value={money(dashboard.monthSummary.salesMinor)}
            />
            <Row
              label={t('reports.expenses')}
              value={money(dashboard.monthSummary.expensesMinor)}
            />
            <Row
              label={t('reports.netProfit')}
              value={money(dashboard.monthSummary.netProfitMinor)}
            />
          </Card>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('dashboard.quickActions')}</Text>
            <View style={styles.actions}>
              {hasPermission('sales.create') ? (
                <AppButton
                  title={t('sales.newSale')}
                  onPress={() => router.push('/sales/new')}
                />
              ) : null}
              {hasPermission('products.view') ? (
                <AppButton
                  title={t('products.title')}
                  variant="secondary"
                  onPress={() => router.push('/products')}
                />
              ) : null}
              {hasPermission('stock.purchase') ? (
                <AppButton
                  title={t('purchases.title')}
                  variant="secondary"
                  onPress={() => router.push('/stock-purchases')}
                />
              ) : null}
              {hasPermission('expenses.view') ? (
                <AppButton
                  title={t('expenses.title')}
                  variant="secondary"
                  onPress={() => router.push('/expenses')}
                />
              ) : null}
              {hasPermission('closings.view') ? (
                <AppButton
                  title={t('closings.title')}
                  variant="secondary"
                  onPress={() => router.push('/closings')}
                />
              ) : null}
              {hasPermission('employees.view') ? (
                <AppButton
                  title={t('settings.employees')}
                  variant="secondary"
                  onPress={() => router.push('/employees')}
                />
              ) : null}
              {hasPermission('settings.manage') ? (
                <AppButton
                  title={t('settings.restaurantSettings')}
                  variant="secondary"
                  onPress={() => router.push('/restaurant-settings')}
                />
              ) : null}
              <AppButton
                title={t('nav.settings')}
                variant="secondary"
                onPress={() => router.push('/settings')}
              />
            </View>
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: 24,
  },
  greeting: {
    fontSize: 26,
    fontWeight: '800',
  },
  restaurant: {
    marginTop: 10,
    fontSize: 20,
    fontWeight: '700',
  },
  role: {
    marginTop: 4,
    fontSize: 14,
    opacity: 0.65,
  },
  date: {
    marginTop: 4,
    fontSize: 13,
    opacity: 0.5,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actions: {
    gap: 10,
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
