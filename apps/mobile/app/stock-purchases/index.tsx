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
  createStockPurchase,
  getSettings,
  listInventoryItems,
  listStockPurchases,
  listSuppliers,
  type InventoryItem,
  type SettingsData,
  type StockPurchase,
  type Supplier,
} from '@/src/api/business';
import { useAuth } from '@/src/auth/AuthProvider';
import { useRestaurantId } from '@/src/hooks/useRestaurantId';
import { startOfMonth, todayDateOnly } from '@/src/utils/date';

export default function StockPurchasesScreen() {
  const { t } = useTranslation();
  const restaurantId = useRestaurantId();
  const { activeMembership, hasPermission } = useAuth();
  const currency = activeMembership?.restaurant.currency ?? 'MWK';
  const canPurchase = hasPermission('stock.purchase');
  const [purchases, setPurchases] = useState<StockPurchase[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [inventoryItemId, setInventoryItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [supplierId, setSupplierId] = useState('');
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
      const [purchasePage, itemPage, settingsData, supplierPage] =
        await Promise.all([
          listStockPurchases(restaurantId, {
            startDate: startOfMonth(today),
            endDate: today,
          }),
          listInventoryItems(restaurantId, {}),
          getSettings(restaurantId),
          listSuppliers(restaurantId, { activeOnly: true }),
        ]);
      setPurchases(purchasePage.items);
      setItems(itemPage.items);
      setSettings(settingsData);
      setSuppliers(supplierPage.items);
      setInventoryItemId((current) => current || itemPage.items[0]?.id || '');
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

  const selectedItem = items.find((item) => item.id === inventoryItemId);
  const paymentMethods =
    settings?.paymentMethods.filter((method) => method.isActive) ?? [];
  const total = unitPrice.trim() ? parseMoneyToMinor(unitPrice, currency) : 0n;
  const lineTotal =
    quantity.trim() && total > 0n
      ? BigInt(Math.round(Number(total) * Number(quantity)))
      : 0n;
  const canSubmit =
    canPurchase &&
    Boolean(inventoryItemId) &&
    Boolean(paymentMethodId) &&
    Number(quantity) > 0 &&
    total > 0n;

  async function submit() {
    if (!restaurantId || !canSubmit || !selectedItem) return;
    setSaving(true);
    setError(null);

    try {
      await createStockPurchase(restaurantId, {
        occurredAt: new Date().toISOString(),
        supplierId: supplierId || undefined,
        paymentMethodId,
        notes: notes.trim() || undefined,
        items: [
          {
            inventoryItemId,
            quantity: quantity.trim(),
            unit: selectedItem.unit,
            unitPriceMinor: total.toString(),
          },
        ],
      });
      setQuantity('');
      setUnitPrice('');
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
      <Text style={styles.title}>{t('purchases.title')}</Text>

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingBlock label={t('common.loading')} /> : null}

      {!loading && purchases.length === 0 ? (
        <EmptyText>{t('purchases.empty')}</EmptyText>
      ) : null}

      {purchases.map((purchase) => (
        <Card key={purchase.id}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleArea}>
              <Text style={styles.name}>{purchase.purchaseNumber}</Text>
              <Text style={styles.meta}>
                {new Date(purchase.occurredAt).toLocaleString()}
              </Text>
            </View>
            <Pill
              label={
                purchase.status === 'RECEIVED'
                  ? t('common.active')
                  : t('expenses.voided')
              }
              tone={purchase.status === 'RECEIVED' ? 'positive' : 'danger'}
            />
          </View>
          <Row
            label={t('purchases.total')}
            value={formatMoney(BigInt(purchase.totalMinor), currency)}
          />
          <Row
            label={t('purchases.supplier')}
            value={purchase.supplierName ?? t('common.none')}
          />
          <Row
            label={t('purchases.paymentMethod')}
            value={purchase.paymentMethodName}
          />
          <Row
            label={t('purchases.recordedBy')}
            value={purchase.recordedBy}
          />
          {purchase.items ? (
            <Text style={styles.detail}>
              {purchase.items
                .map((item) => `${item.name} ${item.quantity} ${item.unit}`)
                .join(', ')}
            </Text>
          ) : null}
        </Card>
      ))}

      {canPurchase && !loading ? (
        <Card>
          <Text style={styles.formTitle}>{t('purchases.newPurchase')}</Text>

          <Text style={styles.fieldLabel}>{t('purchases.item')}</Text>
          {items.length === 0 ? (
            <EmptyText>{t('inventory.empty')}</EmptyText>
          ) : (
            <View style={styles.chips}>
              {items.map((item) => (
                <Chip
                  key={item.id}
                  label={`${item.name} (${item.currentQuantity} ${item.unit})`}
                  selected={item.id === inventoryItemId}
                  onPress={() => setInventoryItemId(item.id)}
                />
              ))}
            </View>
          )}

          <FormField
            label={`${t('purchases.quantity')}${selectedItem ? ` (${selectedItem.unit})` : ''}`}
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="decimal-pad"
          />
          <FormField
            label={t('purchases.unitPrice', { currency })}
            value={unitPrice}
            onChangeText={setUnitPrice}
            keyboardType="decimal-pad"
          />

          {suppliers.length > 0 ? (
            <>
              <Text style={styles.fieldLabel}>{t('purchases.supplier')}</Text>
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
            multiline
          />

          <Row label={t('purchases.lineTotal')} value={formatMoney(lineTotal, currency)} />

          <AppButton
            title={t('purchases.save')}
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
