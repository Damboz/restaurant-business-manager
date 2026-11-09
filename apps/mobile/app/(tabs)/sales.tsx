import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMoney, parseMoneyToMinor } from '@rbm/shared';

import { Text, View } from '@/components/Themed';
import { AppButton } from '@/src/components/AppButton';
import { Chip } from '@/src/components/Chip';
import { FormField } from '@/src/components/FormField';
import { Screen } from '@/src/components/Screen';
import { Card, EmptyText, ErrorBanner, LoadingBlock, Row } from '@/src/components/ui';
import {
  createSale,
  getSettings,
  listSales,
  type Sale,
  type SettingsData,
} from '@/src/api/business';
import { useAuth } from '@/src/auth/AuthProvider';
import { useRestaurantId } from '@/src/hooks/useRestaurantId';
import {
  isDateOnly,
  occurredAtForDate,
  startOfMonth,
  todayDateOnly,
} from '@/src/utils/date';

export default function SalesScreen() {
  const { t } = useTranslation();
  const restaurantId = useRestaurantId();
  const { activeMembership } = useAuth();
  const currency = activeMembership?.restaurant.currency ?? 'MWK';
  const [sales, setSales] = useState<Sale[]>([]);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayDateOnly());
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    setError(null);

    try {
      const today = todayDateOnly();
      const [salePage, settingsData] = await Promise.all([
        listSales(restaurantId, {
          startDate: startOfMonth(today),
          endDate: today,
          status: 'COMPLETED',
        }),
        getSettings(restaurantId),
      ]);
      setSales(salePage.items);
      setSettings(settingsData);
      setPaymentMethodId((current) => {
        if (current) return current;
        const method = settingsData.paymentMethods.find((item) => item.isActive);
        return method?.id ?? '';
      });
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

  const paymentMethods =
    settings?.paymentMethods.filter((method) => method.isActive) ?? [];
  const amountMinor = amount.trim() ? parseMoneyToMinor(amount, currency) : 0n;
  const canSubmit =
    Boolean(paymentMethodId) && isDateOnly(date) && amountMinor > 0n;
  const total = sales.reduce(
    (sum, sale) => sum + BigInt(sale.totalMinor),
    0n
  );

  async function submit() {
    if (!restaurantId || !canSubmit) return;
    setSaving(true);
    setError(null);

    try {
      await createSale(restaurantId, {
        occurredAt: occurredAtForDate(date),
        source: 'MANUAL',
        notes: notes.trim() || undefined,
        items: [],
        payments: [{ paymentMethodId, amountMinor: amountMinor.toString() }],
      });
      setAmount('');
      setNotes('');
      await load();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.title}>{t('nav.sales')}</Text>

      <Card>
        <FormField
          label={`${t('common.amount')} (${currency})`}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0"
        />
        <FormField
          label={`${t('common.date')} (YYYY-MM-DD)`}
          value={date}
          onChangeText={setDate}
          autoCapitalize="none"
        />

        <Text style={styles.fieldLabel}>{t('sales.paymentMethod')}</Text>
        <View style={styles.chips}>
          {paymentMethods.map((method) => (
            <Chip
              key={method.id}
              label={method.name}
              selected={method.id === paymentMethodId}
              onPress={() => setPaymentMethodId(method.id)}
            />
          ))}
        </View>

        <FormField
          label={`${t('common.notes')} (${t('common.optional')})`}
          value={notes}
          onChangeText={setNotes}
        />

        {error ? <ErrorBanner message={error} /> : null}

        <AppButton
          title={t('sales.save')}
          loading={saving}
          disabled={!canSubmit}
          onPress={() => void submit()}
        />
      </Card>

      <Card>
        <Row label={t('reports.sales')} value={formatMoney(total, currency)} />
        <Row label={t('reports.transactions')} value={String(sales.length)} />
      </Card>

      {loading ? <LoadingBlock label={t('common.loading')} /> : null}
      {!loading && sales.length === 0 ? (
        <EmptyText>{t('sales.empty')}</EmptyText>
      ) : null}

      {sales.map((sale) => (
        <Card key={sale.id}>
          <Row
            label={new Date(sale.occurredAt).toLocaleDateString()}
            value={formatMoney(BigInt(sale.totalMinor), currency)}
          />
          <Text style={styles.meta}>
            {sale.payments.map((payment) => payment.paymentMethodName).join(', ')}
          </Text>
          {sale.notes ? <Text style={styles.meta}>{sale.notes}</Text> : null}
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
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  meta: {
    fontSize: 13,
    opacity: 0.7,
    marginTop: 2,
  },
});
