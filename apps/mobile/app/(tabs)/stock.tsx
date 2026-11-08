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
import { listInventoryItems, type InventoryItem } from '@/src/api/business';
import { useAuth } from '@/src/auth/AuthProvider';
import { useRestaurantId } from '@/src/hooks/useRestaurantId';

export default function StockScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const restaurantId = useRestaurantId();
  const { activeMembership, hasPermission } = useAuth();
  const currency = activeMembership?.restaurant.currency ?? 'MWK';
  const canPurchase = hasPermission('stock.purchase');
  const canManage = hasPermission('stock.manage');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!restaurantId) return;

    setLoading(true);
    setError(null);

    try {
      const page = await listInventoryItems(restaurantId, {
        search: search.trim() || undefined,
        lowStock: lowStockOnly || undefined,
      });
      setItems(page.items);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }, [restaurantId, search, lowStockOnly]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const totalValue = items.reduce(
    (sum, item) => sum + BigInt(item.stockValueMinor),
    0n
  );
  const lowStockCount = items.filter((item) => item.lowStock).length;

  return (
    <Screen>
      <Text style={styles.title}>{t('nav.stock')}</Text>

      <FormField
        label={t('common.search')}
        value={search}
        onChangeText={setSearch}
        returnKeyType="search"
        onSubmitEditing={() => void load()}
      />

      <View style={styles.chips}>
        <Chip
          label={t('inventory.lowStockOnly')}
          selected={lowStockOnly}
          onPress={() => setLowStockOnly((value) => !value)}
        />
        <AppButton
          title={t('common.refresh')}
          variant="secondary"
          onPress={() => void load()}
        />
      </View>

      {canPurchase ? (
        <AppButton
          title={t('purchases.title')}
          onPress={() => router.push('/stock-purchases')}
        />
      ) : null}
      {canManage ? (
        <AppButton
          title={t('inventory.addItem')}
          variant="secondary"
          onPress={() => router.push('/inventory')}
        />
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingBlock label={t('common.loading')} /> : null}

      {!loading ? (
        <Card>
          <Row label={t('reports.inventoryValue')} value={formatMoney(totalValue, currency)} />
          <Row label={t('reports.lowStockItems')} value={String(lowStockCount)} />
        </Card>
      ) : null}

      {!loading && items.length === 0 ? (
        <EmptyText>{t('inventory.empty')}</EmptyText>
      ) : null}

      {items.map((item) => (
        <Card key={item.id}>
          <View style={styles.itemHeader}>
            <View style={styles.itemTitleArea}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>
                {item.categoryName} · {item.currentQuantity} {item.unit}
              </Text>
            </View>
            {item.lowStock ? (
              <Pill label={t('inventory.low')} tone="danger" />
            ) : (
              <Pill label={t('common.ok')} tone="positive" />
            )}
          </View>
          <Row
            label={t('inventory.stockValue')}
            value={formatMoney(BigInt(item.stockValueMinor), currency)}
          />
          <Row
            label={t('inventory.minimum')}
            value={`${item.minimumLevel} ${item.unit}`}
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
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
    alignItems: 'center',
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 6,
  },
  itemTitleArea: {
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
});
