import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
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
  listProducts,
  type Product,
  type SettingsData,
} from '@/src/api/business';
import { useAuth } from '@/src/auth/AuthProvider';
import { useRestaurantId } from '@/src/hooks/useRestaurantId';

type Mode = 'ITEMIZED' | 'MANUAL';

function lineTotalMinor(unitPriceMinor: string, quantity: string): bigint {
  const value = Number(unitPriceMinor) * Number(quantity);
  return Number.isFinite(value) ? BigInt(Math.round(value)) : 0n;
}

export default function NewSaleScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const restaurantId = useRestaurantId();
  const { activeMembership } = useAuth();
  const currency = activeMembership?.restaurant.currency ?? 'MWK';
  const [mode, setMode] = useState<Mode>('ITEMIZED');
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [manualTotal, setManualTotal] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!restaurantId) return;
    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([
      listProducts(restaurantId, { status: 'ACTIVE' }),
      getSettings(restaurantId),
    ])
      .then(([productPage, settingsData]) => {
        if (!active) return;
        setProducts(productPage.items);
        setSettings(settingsData);
        const firstMethod = settingsData.paymentMethods.find(
          (method) => method.isActive
        );
        setPaymentMethodId(firstMethod?.id ?? '');
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

  const paymentMethods = settings?.paymentMethods.filter(
    (method) => method.isActive
  ) ?? [];

  const cart = useMemo(
    () =>
      products
        .map((product) => ({
          product,
          quantity: (quantities[product.id] ?? '').trim(),
        }))
        .filter((line) => Number(line.quantity) > 0),
    [products, quantities]
  );

  const cartTotal = cart.reduce(
    (sum, line) =>
      sum + lineTotalMinor(line.product.sellingPriceMinor, line.quantity),
    0n
  );

  const manualTotalMinor = manualTotal.trim()
    ? parseMoneyToMinor(manualTotal, currency)
    : 0n;
  const total = mode === 'MANUAL' ? manualTotalMinor : cartTotal;
  const canSubmit =
    Boolean(paymentMethodId) &&
    total > 0n &&
    (mode === 'MANUAL' || cart.length > 0);

  async function submit() {
    if (!restaurantId || !canSubmit) return;
    setSaving(true);
    setError(null);

    try {
      await createSale(restaurantId, {
        occurredAt: new Date().toISOString(),
        source: mode,
        notes: notes.trim() || undefined,
        items:
          mode === 'ITEMIZED'
            ? cart.map((line) => ({
                productId: line.product.id,
                productName: line.product.name,
                quantity: line.quantity,
                unitPriceMinor: line.product.sellingPriceMinor,
              }))
            : [],
        payments: [{ paymentMethodId, amountMinor: total.toString() }],
      });
      router.back();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.title}>{t('sales.newSale')}</Text>

      <View style={styles.chips}>
        <Chip
          label={t('sales.itemized')}
          selected={mode === 'ITEMIZED'}
          onPress={() => setMode('ITEMIZED')}
        />
        <Chip
          label={t('sales.manual')}
          selected={mode === 'MANUAL'}
          onPress={() => setMode('MANUAL')}
        />
      </View>

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingBlock label={t('common.loading')} /> : null}

      {!loading && mode === 'ITEMIZED' ? (
        <>
          {products.length === 0 ? (
            <EmptyText>{t('products.empty')}</EmptyText>
          ) : null}
          {products.map((product) => {
            const quantity = quantities[product.id] ?? '';
            return (
              <Card key={product.id}>
                <Row
                  label={product.name}
                  value={formatMoney(
                    BigInt(product.sellingPriceMinor),
                    currency
                  )}
                />
                <FormField
                  label={t('sales.quantity')}
                  value={quantity}
                  onChangeText={(value) =>
                    setQuantities((current) => ({
                      ...current,
                      [product.id]: value,
                    }))
                  }
                  keyboardType="decimal-pad"
                  placeholder="0"
                />
              </Card>
            );
          })}

          <Card>
            <Row
              label={t('sales.items')}
              value={String(cart.length)}
            />
            <Row
              label={t('sales.total')}
              value={formatMoney(cartTotal, currency)}
            />
          </Card>
        </>
      ) : null}

      {!loading && mode === 'MANUAL' ? (
        <Card>
          <FormField
            label={t('sales.manualTotal', { currency })}
            value={manualTotal}
            onChangeText={setManualTotal}
            keyboardType="decimal-pad"
          />
          <Row
            label={t('sales.total')}
            value={formatMoney(manualTotalMinor, currency)}
          />
        </Card>
      ) : null}

      {!loading ? (
        <Card>
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
            multiline
          />
          <AppButton
            title={t('sales.save')}
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
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
});
