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
import { Card, EmptyText, ErrorBanner, LoadingBlock, Pill, Row } from '@/src/components/ui';
import {
  createExpense,
  getSettings,
  listExpenses,
  listSuppliers,
  voidExpense,
  type Expense,
  type SettingsData,
  type Supplier,
} from '@/src/api/business';
import { useAuth } from '@/src/auth/AuthProvider';
import { useRestaurantId } from '@/src/hooks/useRestaurantId';
import { startOfMonth, todayDateOnly } from '@/src/utils/date';

export default function ExpensesScreen() {
  const { t } = useTranslation();
  const restaurantId = useRestaurantId();
  const { activeMembership, hasPermission } = useAuth();
  const currency = activeMembership?.restaurant.currency ?? 'MWK';
  const canCreate = hasPermission('expenses.create');
  const canVoid = hasPermission('expenses.manage');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('unit');
  const [unitPrice, setUnitPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const load = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    setError(null);

    try {
      const today = todayDateOnly();
      const [expensePage, settingsData, supplierPage] = await Promise.all([
        listExpenses(restaurantId, {
          startDate: startOfMonth(today),
          endDate: today,
        }),
        getSettings(restaurantId),
        listSuppliers(restaurantId, { activeOnly: true }),
      ]);
      setExpenses(expensePage.items);
      setSettings(settingsData);
      setSuppliers(supplierPage.items);
      setCategoryId((current) => current || settingsData.expenseCategories[0]?.id || '');
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
  const categories = settings?.expenseCategories ?? [];
  const total = unitPrice.trim() ? parseMoneyToMinor(unitPrice, currency) : 0n;
  const canSubmit =
    canCreate &&
    Boolean(categoryId) &&
    Boolean(paymentMethodId) &&
    Boolean(description.trim()) &&
    Boolean(unit.trim()) &&
    Number(quantity) > 0 &&
    total > 0n;

  async function submit() {
    if (!restaurantId || !canSubmit) return;
    setSaving(true);
    setError(null);

    try {
      await createExpense(restaurantId, {
        occurredAt: new Date().toISOString(),
        supplierId: supplierId || undefined,
        paymentMethodId,
        notes: notes.trim() || undefined,
        items: [
          {
            categoryId,
            description: description.trim(),
            quantity: quantity.trim(),
            unit: unit.trim(),
            unitPriceMinor: total.toString(),
          },
        ],
      });
      setDescription('');
      setUnitPrice('');
      setNotes('');
      await load();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleVoid(expense: Expense) {
    if (!restaurantId || !voidReason.trim()) return;
    setSaving(true);
    setError(null);

    try {
      await voidExpense(restaurantId, expense.id, voidReason.trim());
      setVoidingId(null);
      setVoidReason('');
      await load();
    } catch (voidError) {
      setError((voidError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.title}>{t('expenses.title')}</Text>

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingBlock label={t('common.loading')} /> : null}

      {!loading && expenses.length === 0 ? (
        <EmptyText>{t('expenses.empty')}</EmptyText>
      ) : null}

      {expenses.map((expense) => (
        <Card key={expense.id}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleArea}>
              <Text style={styles.name}>{expense.expenseNumber}</Text>
              <Text style={styles.meta}>
                {new Date(expense.occurredAt).toLocaleString()}
              </Text>
            </View>
            <Pill
              label={
                expense.status === 'ACTIVE'
                  ? t('common.active')
                  : t('expenses.voided')
              }
              tone={expense.status === 'ACTIVE' ? 'positive' : 'danger'}
            />
          </View>
          <Row
            label={t('common.total')}
            value={formatMoney(BigInt(expense.totalMinor), currency)}
          />
          <Row
            label={t('expenses.supplier')}
            value={expense.supplier?.name ?? t('common.none')}
          />
          <Row
            label={t('expenses.paymentMethod')}
            value={expense.paymentMethod.name}
          />
          <Text style={styles.detail}>
            {expense.items
              .map(
                (item) =>
                  `${item.description} (${item.quantity} ${item.unit})`
              )
              .join(', ')}
          </Text>

          {canVoid && expense.status === 'ACTIVE' ? (
            voidingId === expense.id ? (
              <View style={styles.voidForm}>
                <FormField
                  label={t('expenses.voidReason')}
                  value={voidReason}
                  onChangeText={setVoidReason}
                />
                <View style={styles.voidActions}>
                  <AppButton
                    title={t('expenses.confirmVoid')}
                    variant="danger"
                    loading={saving}
                    disabled={!voidReason.trim()}
                    onPress={() => void handleVoid(expense)}
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
                title={t('expenses.void')}
                variant="ghost"
                onPress={() => {
                  setVoidingId(expense.id);
                  setVoidReason('');
                }}
              />
            )
          ) : null}
        </Card>
      ))}

      {canCreate && !loading ? (
        <Card>
          <Text style={styles.formTitle}>{t('expenses.newExpense')}</Text>

          <Text style={styles.fieldLabel}>{t('expenses.category')}</Text>
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

          {suppliers.length > 0 ? (
            <>
              <Text style={styles.fieldLabel}>{t('expenses.supplier')}</Text>
              <View style={styles.chips}>
                <Chip
                  label={t('common.none')}
                  selected={!supplierId}
                  onPress={() => setSupplierId('')}
                />
                {suppliers.map((supplier) => (
                  <Chip
                    key={supplier.id}
                    label={supplier.name}
                    selected={supplier.id === supplierId}
                    onPress={() => setSupplierId(supplier.id)}
                  />
                ))}
              </View>
            </>
          ) : null}

          <FormField
            label={t('expenses.description')}
            value={description}
            onChangeText={setDescription}
          />
          <FormField
            label={t('expenses.quantity')}
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="decimal-pad"
          />
          <FormField label={t('expenses.unit')} value={unit} onChangeText={setUnit} />
          <FormField
            label={t('expenses.unitPrice', { currency })}
            value={unitPrice}
            onChangeText={setUnitPrice}
            keyboardType="decimal-pad"
          />

          <Text style={styles.fieldLabel}>{t('expenses.paymentMethod')}</Text>
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
            multiline
          />

          <Row label={t('common.total')} value={formatMoney(total, currency)} />

          <AppButton
            title={t('expenses.save')}
            loading={saving}
            disabled={!canSubmit}
            onPress={() => void submit()}
          />
        </Card>
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
  formTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 14,
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
});
