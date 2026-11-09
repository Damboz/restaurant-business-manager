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
  createExpense,
  getSettings,
  listExpenses,
  type Expense,
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

export default function PurchasesScreen() {
  const { t } = useTranslation();
  const restaurantId = useRestaurantId();
  const { activeMembership } = useAuth();
  const currency = activeMembership?.restaurant.currency ?? 'MWK';
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayDateOnly());
  const [categoryId, setCategoryId] = useState('');
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
      const [expensePage, settingsData] = await Promise.all([
        listExpenses(restaurantId, {
          startDate: startOfMonth(today),
          endDate: today,
          status: 'ACTIVE',
        }),
        getSettings(restaurantId),
      ]);
      setExpenses(expensePage.items);
      setSettings(settingsData);
      setCategoryId(
        (current) => current || settingsData.expenseCategories[0]?.id || ''
      );
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

  const categories = settings?.expenseCategories ?? [];
  const paymentMethods =
    settings?.paymentMethods.filter((method) => method.isActive) ?? [];
  const amountMinor = amount.trim() ? parseMoneyToMinor(amount, currency) : 0n;
  const canSubmit =
    Boolean(categoryId) &&
    Boolean(paymentMethodId) &&
    Boolean(description.trim()) &&
    isDateOnly(date) &&
    amountMinor > 0n;
  const total = expenses.reduce(
    (sum, expense) => sum + BigInt(expense.totalMinor),
    0n
  );

  async function submit() {
    if (!restaurantId || !canSubmit) return;
    setSaving(true);
    setError(null);

    try {
      await createExpense(restaurantId, {
        occurredAt: occurredAtForDate(date),
        paymentMethodId,
        notes: notes.trim() || undefined,
        items: [
          {
            categoryId,
            description: description.trim(),
            quantity: '1',
            unit: 'unit',
            unitPriceMinor: amountMinor.toString(),
          },
        ],
      });
      setAmount('');
      setDescription('');
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
      <Text style={styles.title}>{t('nav.purchases')}</Text>

      <Card>
        <FormField
          label={`${t('common.amount')} (${currency})`}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0"
        />
        <FormField
          label={t('purchases.description')}
          value={description}
          onChangeText={setDescription}
          placeholder={t('purchases.descriptionPlaceholder')}
        />
        <FormField
          label={`${t('common.date')} (YYYY-MM-DD)`}
          value={date}
          onChangeText={setDate}
          autoCapitalize="none"
        />

        <Text style={styles.fieldLabel}>{t('purchases.category')}</Text>
        <View style={styles.chips}>
          {categories.map((category) => (
            <Chip
              key={category.id}
              label={category.name}
              selected={category.id === categoryId}
              onPress={() => setCategoryId(category.id)}
            />
          ))}
        </View>

        <Text style={styles.fieldLabel}>{t('purchases.paymentMethod')}</Text>
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
          title={t('purchases.save')}
          loading={saving}
          disabled={!canSubmit}
          onPress={() => void submit()}
        />
      </Card>

      <Card>
        <Row label={t('nav.purchases')} value={formatMoney(total, currency)} />
        <Row label={t('reports.transactions')} value={String(expenses.length)} />
      </Card>

      {loading ? <LoadingBlock label={t('common.loading')} /> : null}
      {!loading && expenses.length === 0 ? (
        <EmptyText>{t('purchases.empty')}</EmptyText>
      ) : null}

      {expenses.map((expense) => (
        <Card key={expense.id}>
          <Row
            label={
              expense.items[0]?.description ??
              new Date(expense.occurredAt).toLocaleDateString()
            }
            value={formatMoney(BigInt(expense.totalMinor), currency)}
          />
          <Text style={styles.meta}>
            {new Date(expense.occurredAt).toLocaleDateString()} ·{' '}
            {expense.items[0]?.categoryName ?? ''}
          </Text>
          {expense.notes ? <Text style={styles.meta}>{expense.notes}</Text> : null}
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
