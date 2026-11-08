import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@rbm/shared';

import { Text, View } from '@/components/Themed';
import { AppButton } from '@/src/components/AppButton';
import { Chip } from '@/src/components/Chip';
import { FormField } from '@/src/components/FormField';
import { Screen } from '@/src/components/Screen';
import { Card, EmptyText, ErrorBanner, LoadingBlock, Pill, Row } from '@/src/components/ui';
import {
  listSales,
  voidSale,
  type Sale,
} from '@/src/api/business';
import { useAuth } from '@/src/auth/AuthProvider';
import { useRestaurantId } from '@/src/hooks/useRestaurantId';
import { startOfMonth, startOfWeek, todayDateOnly } from '@/src/utils/date';

type Period = 'today' | 'week' | 'month';

const PERIODS: Period[] = ['today', 'week', 'month'];

function rangeFor(period: Period): { startDate?: string; endDate?: string } {
  const today = todayDateOnly();

  if (period === 'week') {
    return { startDate: startOfWeek(today), endDate: today };
  }

  if (period === 'month') {
    return { startDate: startOfMonth(today), endDate: today };
  }

  return { startDate: today, endDate: today };
}

export default function SalesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const restaurantId = useRestaurantId();
  const { activeMembership, hasPermission } = useAuth();
  const currency = activeMembership?.restaurant.currency ?? 'MWK';
  const canCreate = hasPermission('sales.create');
  const canVoid = hasPermission('sales.void');
  const [sales, setSales] = useState<Sale[]>([]);
  const [period, setPeriod] = useState<Period>('today');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!restaurantId) return;

    setLoading(true);
    setError(null);

    try {
      const page = await listSales(restaurantId, rangeFor(period));
      setSales(page.items);
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

  async function handleVoid(sale: Sale) {
    if (!restaurantId || !voidReason.trim()) return;

    setSaving(true);
    setError(null);

    try {
      await voidSale(restaurantId, sale.id, voidReason.trim());
      setVoidingId(null);
      setVoidReason('');
      await load();
    } catch (voidError) {
      setError((voidError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const total = sales
    .filter((sale) => sale.status === 'COMPLETED')
    .reduce((sum, sale) => sum + BigInt(sale.totalMinor), 0n);

  return (
    <Screen>
      <Text style={styles.title}>{t('sales.title')}</Text>

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

      {canCreate ? (
        <AppButton
          title={t('sales.newSale')}
          onPress={() => router.push('/sales/new')}
        />
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingBlock label={t('common.loading')} /> : null}

      {!loading ? (
        <Card>
          <Row label={t('sales.total')} value={formatMoney(total, currency)} />
          <Row label={t('reports.transactions')} value={String(sales.length)} />
        </Card>
      ) : null}

      {!loading && sales.length === 0 ? (
        <EmptyText>{t('sales.empty')}</EmptyText>
      ) : null}

      {sales.map((sale) => (
        <Card key={sale.id}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleArea}>
              <Text style={styles.name}>{sale.transactionNumber}</Text>
              <Text style={styles.meta}>
                {new Date(sale.occurredAt).toLocaleString()}
              </Text>
            </View>
            <Pill
              label={
                sale.status === 'COMPLETED'
                  ? t('sales.completed')
                  : t('sales.voided')
              }
              tone={sale.status === 'COMPLETED' ? 'positive' : 'danger'}
            />
          </View>

          <Row
            label={t('common.total')}
            value={formatMoney(BigInt(sale.totalMinor), currency)}
          />
          <Row
            label={t('sales.source')}
            value={
              sale.source === 'MANUAL'
                ? t('sales.manual')
                : t('sales.itemized')
            }
          />
          <Row
            label={t('sales.paymentMethod')}
            value={
              sale.payments.map((payment) => payment.paymentMethodName).join(', ') ||
              t('common.none')
            }
          />
          <Text style={styles.detail}>
            {sale.items.length > 0
              ? sale.items
                  .map((item) => `${item.productName} x${item.quantity}`)
                  .join(', ')
              : t('sales.manualSale')}
          </Text>

          {canVoid && sale.status === 'COMPLETED' ? (
            voidingId === sale.id ? (
              <View style={styles.voidForm}>
                <FormField
                  label={t('sales.voidReason')}
                  value={voidReason}
                  onChangeText={setVoidReason}
                />
                <View style={styles.voidActions}>
                  <AppButton
                    title={t('sales.confirmVoid')}
                    variant="danger"
                    loading={saving}
                    disabled={!voidReason.trim()}
                    onPress={() => void handleVoid(sale)}
                  />
                  <AppButton
                    title={t('common.cancel')}
                    variant="ghost"
                    onPress={() => {
                      setVoidingId(null);
                      setVoidReason('');
                    }}
                  />
                </View>
              </View>
            ) : (
              <AppButton
                title={t('sales.void')}
                variant="ghost"
                onPress={() => {
                  setVoidingId(sale.id);
                  setVoidReason('');
                }}
              />
            )
          ) : null}
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
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
  detail: {
    marginTop: 8,
    fontSize: 13,
    opacity: 0.7,
  },
  voidForm: {
    marginTop: 12,
  },
  voidActions: {
    gap: 8,
  },
});
