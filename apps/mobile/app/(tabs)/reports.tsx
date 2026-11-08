import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@rbm/shared';

import { Text, View } from '@/components/Themed';
import { Chip } from '@/src/components/Chip';
import { Screen } from '@/src/components/Screen';
import { Card, EmptyText, ErrorBanner, LoadingBlock, Row } from '@/src/components/ui';
import { getReportSummary, type ReportSummary } from '@/src/api/business';
import { useAuth } from '@/src/auth/AuthProvider';
import { useRestaurantId } from '@/src/hooks/useRestaurantId';
import {
  formatDate,
  startOfMonth,
  startOfWeek,
  startOfYear,
  todayDateOnly,
} from '@/src/utils/date';

type Period = 'today' | 'week' | 'month' | 'year';

const PERIODS: Period[] = ['today', 'week', 'month', 'year'];

function rangeFor(period: Period): { startDate: string; endDate: string } {
  const today = todayDateOnly();

  if (period === 'week') {
    return { startDate: startOfWeek(today), endDate: today };
  }

  if (period === 'month') {
    return { startDate: startOfMonth(today), endDate: today };
  }

  if (period === 'year') {
    return { startDate: startOfYear(today), endDate: today };
  }

  return { startDate: today, endDate: today };
}

export default function ReportsScreen() {
  const { t } = useTranslation();
  const restaurantId = useRestaurantId();
  const { activeMembership } = useAuth();
  const currency = activeMembership?.restaurant.currency ?? 'MWK';
  const [period, setPeriod] = useState<Period>('month');
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!restaurantId) return;

    setLoading(true);
    setError(null);

    try {
      setSummary(await getReportSummary(restaurantId, rangeFor(period)));
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

  const money = (value: string | undefined) =>
    formatMoney(BigInt(value ?? '0'), currency);
  const netProfit = summary ? BigInt(summary.netProfitMinor) : 0n;

  return (
    <Screen>
      <Text style={styles.title}>{t('reports.title')}</Text>

      <View style={styles.chips}>
        {PERIODS.map((value) => (
          <Chip
            key={value}
            label={t(`common.${value}`)}
            selected={period === value}
            onPress={() => setPeriod(value)}
          />
        ))}
      </View>

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingBlock label={t('common.loading')} /> : null}

      {!loading && summary ? (
        <>
          <Card>
            <Text style={styles.cardTitle}>
              {summary.startDate === summary.endDate
                ? formatDate(summary.startDate)
                : `${formatDate(summary.startDate)} – ${formatDate(summary.endDate)}`}
            </Text>
            <Row label={t('reports.revenue')} value={money(summary.sales.totalMinor)} />
            <Row label={t('reports.cogs')} value={money(summary.cogsMinor)} />
            <Row
              label={t('reports.grossProfit')}
              value={money(summary.grossProfitMinor)}
            />
            <Row
              label={t('reports.operatingExpenses')}
              value={money(summary.expenses.operatingMinor)}
            />
            <Row
              label={netProfit < 0n ? t('reports.loss') : t('reports.netProfit')}
              value={money(summary.netProfitMinor)}
            />
            <Row
              label={t('reports.transactions')}
              value={String(summary.sales.transactionCount)}
            />
            <Row
              label={t('reports.averageTransaction')}
              value={money(summary.sales.averageTransactionMinor)}
            />
          </Card>

          <Card>
            <Text style={styles.cardTitle}>{t('reports.paymentBreakdown')}</Text>
            <Row label={t('reports.cash')} value={money(summary.sales.byPayment.cashMinor)} />
            <Row
              label={t('reports.mobileMoney')}
              value={money(summary.sales.byPayment.mobileMoneyMinor)}
            />
            <Row label={t('reports.bank')} value={money(summary.sales.byPayment.bankMinor)} />
            <Row label={t('reports.other')} value={money(summary.sales.byPayment.otherMinor)} />
          </Card>

          <Card>
            <Text style={styles.cardTitle}>{t('reports.topProducts')}</Text>
            {summary.topProducts.length === 0 ? (
              <EmptyText>{t('reports.noData')}</EmptyText>
            ) : (
              summary.topProducts.map((product) => (
                <Row
                  key={product.name}
                  label={`${product.name} x${product.quantity}`}
                  value={money(product.revenueMinor)}
                />
              ))
            )}
          </Card>

          <Card>
            <Text style={styles.cardTitle}>{t('reports.inventoryValue')}</Text>
            <Row
              label={t('reports.inventoryValue')}
              value={money(summary.inventory.valueMinor)}
            />
            <Row
              label={t('reports.lowStockItems')}
              value={String(summary.inventory.lowStockCount)}
            />
            {summary.inventory.lowStockItems.slice(0, 5).map((item) => (
              <Row
                key={item.id}
                label={`${item.name} (${item.currentQuantity} ${item.unit})`}
                value={`${item.minimumLevel} ${item.unit}`}
              />
            ))}
          </Card>

          <Card>
            <Text style={styles.cardTitle}>{t('reports.dailyBreakdown')}</Text>
            {summary.daily.length === 0 ? (
              <EmptyText>{t('reports.noData')}</EmptyText>
            ) : (
              summary.daily
                .slice(-7)
                .map((day) => (
                  <Row
                    key={day.date}
                    label={formatDate(day.date)}
                    value={`${money(day.salesMinor)} · ${day.transactions} ${t('reports.transactions')}`}
                  />
                ))
            )}
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
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
