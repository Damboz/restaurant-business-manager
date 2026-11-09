import { useFocusEffect } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@rbm/shared';

import { Text, View } from '@/components/Themed';
import { AppButton } from '@/src/components/AppButton';
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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

type ReportTranslator = (key: string) => string;

function buildReportHtml(
  summary: ReportSummary,
  currency: string,
  restaurantName: string,
  t: ReportTranslator,
  generatedAt: Date
) {
  const money = (value: string | undefined) =>
    escapeHtml(formatMoney(BigInt(value ?? '0'), currency));
  const noData = escapeHtml(t('reports.noData'));
  const netProfit = BigInt(summary.netProfitMinor);

  const summaryRows: Array<[string, string]> = [
    [t('reports.revenue'), money(summary.sales.totalMinor)],
    [t('reports.cogs'), money(summary.cogsMinor)],
    [t('reports.grossProfit'), money(summary.grossProfitMinor)],
    [t('reports.operatingExpenses'), money(summary.expenses.operatingMinor)],
    [netProfit < 0n ? t('reports.loss') : t('reports.netProfit'), money(summary.netProfitMinor)],
    [t('reports.transactions'), String(summary.sales.transactionCount)],
    [t('reports.averageTransaction'), money(summary.sales.averageTransactionMinor)],
  ];

  const paymentRows: Array<[string, string]> = [
    [t('reports.cash'), money(summary.sales.byPayment.cashMinor)],
    [t('reports.mobileMoney'), money(summary.sales.byPayment.mobileMoneyMinor)],
    [t('reports.bank'), money(summary.sales.byPayment.bankMinor)],
    [t('reports.other'), money(summary.sales.byPayment.otherMinor)],
  ];

  const tableRows = (rows: Array<[string, string]>) =>
    rows
      .map(
        ([label, value]) =>
          `<tr><td class="label">${escapeHtml(label)}</td><td class="value">${value}</td></tr>`
      )
      .join('');

  const productRows =
    summary.topProducts.length === 0
      ? `<tr><td colspan="3" class="empty">${noData}</td></tr>`
      : summary.topProducts
          .map(
            (product) =>
              `<tr><td>${escapeHtml(product.name)}</td><td class="value">${escapeHtml(
                product.quantity
              )}</td><td class="value">${money(product.revenueMinor)}</td></tr>`
          )
          .join('');

  const dailyRows =
    summary.daily.length === 0
      ? `<tr><td colspan="3" class="empty">${noData}</td></tr>`
      : summary.daily
          .map(
            (day) =>
              `<tr><td>${escapeHtml(formatDate(day.date))}</td><td class="value">${money(
                day.salesMinor
              )}</td><td class="value">${day.transactions}</td></tr>`
          )
          .join('');

  const period =
    summary.startDate === summary.endDate
      ? formatDate(summary.startDate)
      : `${formatDate(summary.startDate)} - ${formatDate(summary.endDate)}`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { margin: 24px; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1f2933; margin: 0; }
  h1 { font-size: 24px; margin: 0 0 4px; color: #0f5132; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.6px; color: #52606d; margin: 24px 0 8px; }
  .muted { color: #52606d; font-size: 13px; }
  .period { font-size: 16px; font-weight: 600; margin-top: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 7px 0; border-bottom: 1px solid #e4e7eb; vertical-align: top; }
  .label { color: #52606d; }
  .value { text-align: right; font-weight: 600; white-space: nowrap; }
  .empty { color: #7b8794; text-align: center; padding: 12px 0; }
  .footer { margin-top: 28px; font-size: 11px; color: #7b8794; }
</style>
</head>
<body>
  <h1>${escapeHtml(restaurantName)}</h1>
  <div class="muted">${escapeHtml(t('reports.title'))}</div>
  <div class="period">${escapeHtml(period)}</div>

  <h2>${escapeHtml(t('reports.title'))}</h2>
  <table>${tableRows(summaryRows)}</table>

  <h2>${escapeHtml(t('reports.paymentBreakdown'))}</h2>
  <table>${tableRows(paymentRows)}</table>

  <h2>${escapeHtml(t('reports.topProducts'))}</h2>
  <table>
    <tr><td class="label">${escapeHtml(t('reports.topProducts'))}</td><td class="value">${escapeHtml(
      t('common.quantity')
    )}</td><td class="value">${escapeHtml(t('reports.revenue'))}</td></tr>
    ${productRows}
  </table>

  <h2>${escapeHtml(t('reports.dailyBreakdown'))}</h2>
  <table>
    <tr><td class="label">${escapeHtml(t('reports.date'))}</td><td class="value">${escapeHtml(
      t('reports.sales')
    )}</td><td class="value">${escapeHtml(t('reports.transactions'))}</td></tr>
    ${dailyRows}
  </table>

  <h2>${escapeHtml(t('reports.inventoryValue'))}</h2>
  <table>
    ${tableRows([
      [t('reports.inventoryValue'), money(summary.inventory.valueMinor)],
      [t('reports.lowStockItems'), String(summary.inventory.lowStockCount)],
    ])}
  </table>

  <div class="footer">${escapeHtml(t('reports.generatedAt'))} ${escapeHtml(
    generatedAt.toLocaleString()
  )}</div>
</body>
</html>`;
}

export default function ReportsScreen() {
  const { t } = useTranslation();
  const restaurantId = useRestaurantId();
  const { activeMembership, hasPermission } = useAuth();
  const currency = activeMembership?.restaurant.currency ?? 'MWK';
  const [period, setPeriod] = useState<Period>('month');
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
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

  async function exportPdf() {
    if (!summary) {
      return;
    }

    setExporting(true);
    setError(null);

    try {
      const html = buildReportHtml(
        summary,
        currency,
        activeMembership?.restaurant.name ?? t('reports.title'),
        t,
        new Date()
      );
      const { uri } = await Print.printToFileAsync({ html });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: t('reports.exportPdf'),
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert(t('reports.exportPdf'), uri);
      }
    } catch (exportError) {
      setError(
        exportError instanceof Error ? exportError.message : t('reports.exportFailed')
      );
    } finally {
      setExporting(false);
    }
  }

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

      {hasPermission('reports.export') ? (
        <AppButton
          title={exporting ? t('reports.generatingPdf') : t('reports.exportPdf')}
          variant="secondary"
          loading={exporting}
          disabled={!summary || loading}
          onPress={() => void exportPdf()}
          style={styles.exportButton}
        />
      ) : null}

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
  exportButton: {
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
