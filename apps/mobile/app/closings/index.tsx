import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@rbm/shared';

import { Text, View } from '@/components/Themed';
import { AppButton } from '@/src/components/AppButton';
import { FormField } from '@/src/components/FormField';
import { Screen } from '@/src/components/Screen';
import { Card, EmptyText, ErrorBanner, LoadingBlock, Pill, Row } from '@/src/components/ui';
import {
  closeDay,
  getClosingPreview,
  listClosings,
  reopenDay,
  type Closing,
  type ClosingPreview,
} from '@/src/api/business';
import { useAuth } from '@/src/auth/AuthProvider';
import { useRestaurantId } from '@/src/hooks/useRestaurantId';
import { addDays, todayDateOnly } from '@/src/utils/date';

export default function ClosingsScreen() {
  const { t } = useTranslation();
  const restaurantId = useRestaurantId();
  const { activeMembership, hasPermission } = useAuth();
  const currency = activeMembership?.restaurant.currency ?? 'MWK';
  const canClose = hasPermission('closings.close');
  const canReopen = hasPermission('closings.reopen');
  const [preview, setPreview] = useState<ClosingPreview | null>(null);
  const [closings, setClosings] = useState<Closing[]>([]);
  const [reopenReason, setReopenReason] = useState('');
  const [showReopen, setShowReopen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    setError(null);

    try {
      const today = todayDateOnly();
      const [previewData, closingPage] = await Promise.all([
        getClosingPreview(restaurantId),
        listClosings(restaurantId, {
          startDate: addDays(today, -30),
          endDate: today,
        }),
      ]);
      setPreview(previewData);
      setClosings(closingPage.items);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const money = (value: string | undefined) =>
    formatMoney(BigInt(value ?? '0'), currency);

  async function handleClose() {
    if (!restaurantId || !preview) return;
    setSaving(true);
    setError(null);

    try {
      await closeDay(restaurantId, preview.businessDate);
      await load();
    } catch (closeError) {
      setError((closeError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleReopen() {
    if (!restaurantId || !preview || !reopenReason.trim()) return;
    setSaving(true);
    setError(null);

    try {
      await reopenDay(restaurantId, preview.businessDate, reopenReason.trim());
      setReopenReason('');
      setShowReopen(false);
      await load();
    } catch (reopenError) {
      setError((reopenError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.title}>{t('closings.title')}</Text>

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingBlock label={t('common.loading')} /> : null}

      {!loading && preview ? (
        <Card>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleArea}>
              <Text style={styles.name}>{preview.businessDate}</Text>
              <Text style={styles.meta}>{t('closings.preview')}</Text>
            </View>
            <Pill
              label={
                preview.status === 'CLOSED'
                  ? t('closings.closed')
                  : t('closings.open')
              }
              tone={preview.status === 'CLOSED' ? 'positive' : 'warning'}
            />
          </View>

          <Row label={t('reports.revenue')} value={money(preview.summary.sales.totalMinor)} />
          <Row label={t('reports.cogs')} value={money(preview.summary.cogsMinor)} />
          <Row
            label={t('reports.grossProfit')}
            value={money(preview.summary.grossProfitMinor)}
          />
          <Row
            label={t('reports.operatingExpenses')}
            value={money(preview.summary.expenses.operatingMinor)}
          />
          <Row
            label={t('reports.netProfit')}
            value={money(preview.summary.netProfitMinor)}
          />
          <Row
            label={t('reports.transactions')}
            value={String(preview.summary.sales.transactionCount)}
          />

          {preview.status === 'CLOSED' && preview.closedAt ? (
            <Row
              label={t('closings.closedAt')}
              value={new Date(preview.closedAt).toLocaleString()}
            />
          ) : null}
          {preview.reopenReason ? (
            <Row label={t('closings.reason')} value={preview.reopenReason} />
          ) : null}

          {preview.status === 'OPEN' && canClose ? (
            <AppButton
              title={t('closings.closeDay')}
              loading={saving}
              onPress={() => void handleClose()}
            />
          ) : null}

          {preview.status === 'CLOSED' && canReopen ? (
            showReopen ? (
              <View style={styles.reopenForm}>
                <FormField
                  label={t('closings.reopenReason')}
                  value={reopenReason}
                  onChangeText={setReopenReason}
                />
                <View style={styles.reopenActions}>
                  <AppButton
                    title={t('closings.reopenDay')}
                    variant="danger"
                    loading={saving}
                    disabled={!reopenReason.trim()}
                    onPress={() => void handleReopen()}
                  />
                  <AppButton
                    title={t('common.cancel')}
                    variant="ghost"
                    onPress={() => {
                      setShowReopen(false);
                      setReopenReason('');
                    }}
                  />
                </View>
              </View>
            ) : (
              <AppButton
                title={t('closings.reopenDay')}
                variant="secondary"
                onPress={() => setShowReopen(true)}
              />
            )
          ) : null}
        </Card>
      ) : null}

      {!loading ? (
        <Text style={styles.sectionTitle}>{t('closings.history')}</Text>
      ) : null}

      {!loading && closings.length === 0 ? (
        <EmptyText>{t('closings.empty')}</EmptyText>
      ) : null}

      {closings.map((closing) => (
        <Card key={closing.id}>
          <View style={styles.cardHeader}>
            <Text style={styles.name}>{closing.businessDate}</Text>
            <Pill
              label={
                closing.status === 'CLOSED'
                  ? t('closings.closed')
                  : t('closings.open')
              }
              tone={closing.status === 'CLOSED' ? 'positive' : 'warning'}
            />
          </View>
          <Row label={t('reports.revenue')} value={money(closing.totalSalesMinor)} />
          <Row label={t('reports.netProfit')} value={money(closing.netProfitMinor)} />
          <Row
            label={t('reports.transactions')}
            value={String(closing.transactionCount)}
          />
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  cardTitleArea: {
    flex: 1,
  },
  name: {
    fontSize: 17,
    fontWeight: '700',
  },
  meta: {
    marginTop: 4,
    fontSize: 13,
    opacity: 0.7,
  },
  reopenForm: {
    marginTop: 12,
  },
  reopenActions: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12,
    marginTop: 8,
  },
});
