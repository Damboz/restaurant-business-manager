import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMoney, parseMoneyToMinor } from '@rbm/shared';

import { Text, View } from '@/components/Themed';
import { AppButton } from '@/src/components/AppButton';
import { Chip } from '@/src/components/Chip';
import { FormField } from '@/src/components/FormField';
import { Screen } from '@/src/components/Screen';
import {
  Card,
  EmptyText,
  ErrorBanner,
  LoadingBlock,
  Pill,
  Row,
} from '@/src/components/ui';
import {
  createInventoryCategory,
  createInventoryItem,
  createStockAdjustment,
  listInventoryCategories,
  listInventoryItems,
  type InventoryCategory,
  type InventoryItem,
} from '@/src/api/business';
import { useAuth } from '@/src/auth/AuthProvider';
import { useRestaurantId } from '@/src/hooks/useRestaurantId';

type AdjustmentType = 'ADJUSTMENT' | 'WASTAGE' | 'RETURN';

export default function InventoryScreen() {
  const { t } = useTranslation();
  const restaurantId = useRestaurantId();
  const { activeMembership, hasPermission } = useAuth();
  const currency = activeMembership?.restaurant.currency ?? 'MWK';
  const canManage = hasPermission('stock.manage');
  const canAdjust = hasPermission('stock.adjust');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [search, setSearch] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [minimumLevel, setMinimumLevel] = useState('0');
  const [categoryId, setCategoryId] = useState('');
  const [openingQuantity, setOpeningQuantity] = useState('');
  const [openingCost, setOpeningCost] = useState('');
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [categoryName, setCategoryName] = useState('');

  const [selectedItemId, setSelectedItemId] = useState('');
  const [adjustType, setAdjustType] = useState<AdjustmentType>('ADJUSTMENT');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');

  async function load() {
    if (!restaurantId) return;
    setLoading(true);
    setError(null);
    try {
      const [page, categoryList] = await Promise.all([
        listInventoryItems(restaurantId, {
          search: search || undefined,
          lowStock: lowStockOnly || undefined,
        }),
        listInventoryCategories(restaurantId),
      ]);
      setItems(page.items);
      setCategories(categoryList);
      if (!categoryId && categoryList[0]) setCategoryId(categoryList[0].id);
      if (!selectedItemId && page.items[0]) setSelectedItemId(page.items[0].id);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [restaurantId, lowStockOnly]);

  async function addCategory() {
    if (!restaurantId || !categoryName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createInventoryCategory(restaurantId, { name: categoryName.trim() });
      setCategoryName('');
      setShowCategoryForm(false);
      await load();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function addItem() {
    if (!restaurantId || !name.trim() || !unit.trim() || !categoryId) return;
    setSaving(true);
    setError(null);
    try {
      await createInventoryItem(restaurantId, {
        categoryId,
        name: name.trim(),
        unit: unit.trim(),
        minimumLevel: minimumLevel.trim() || '0',
        openingQuantity: openingQuantity.trim() || undefined,
        openingUnitCostMinor:
          openingQuantity.trim() && openingCost.trim()
            ? parseMoneyToMinor(openingCost, currency).toString()
            : undefined,
      });
      setName('');
      setUnit('');
      setMinimumLevel('0');
      setOpeningQuantity('');
      setOpeningCost('');
      await load();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function adjust() {
    if (!restaurantId || !selectedItemId || !delta.trim() || !reason.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createStockAdjustment(restaurantId, {
        inventoryItemId: selectedItemId,
        occurredAt: new Date().toISOString(),
        type: adjustType,
        quantityDelta: delta.trim(),
        reason: reason.trim(),
      });
      setDelta('');
      setReason('');
      await load();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.title}>{t('inventory.title')}</Text>
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
        <AppButton title={t('common.refresh')} variant="secondary" onPress={() => void load()} />
      </View>

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingBlock label={t('common.loading')} /> : null}
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
            label={t('inventory.averageCost')}
            value={`${formatMoney(
              BigInt(item.averageCostMinorPerUnit.split('.')[0] ?? '0'),
              currency
            )} / ${item.unit}`}
          />
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

      {canAdjust ? (
        <Card>
          <Text style={styles.formTitle}>{t('inventory.adjustStock')}</Text>
          <Text style={styles.fieldLabel}>{t('inventory.item')}</Text>
          <View style={styles.chips}>
            {items.map((item) => (
              <Chip
                key={item.id}
                label={item.name}
                selected={item.id === selectedItemId}
                onPress={() => setSelectedItemId(item.id)}
              />
            ))}
          </View>
          <Text style={styles.fieldLabel}>{t('inventory.adjustmentType')}</Text>
          <View style={styles.chips}>
            {(['ADJUSTMENT', 'WASTAGE', 'RETURN'] as AdjustmentType[]).map((type) => (
              <Chip
                key={type}
                label={t(`inventory.${type.toLowerCase()}`)}
                selected={adjustType === type}
                onPress={() => setAdjustType(type)}
              />
            ))}
          </View>
          <FormField
            label={t('inventory.quantityDelta')}
            value={delta}
            onChangeText={setDelta}
            keyboardType="numbers-and-punctuation"
            placeholder="-2 or 5"
          />
          <FormField label={t('common.reason')} value={reason} onChangeText={setReason} />
          <AppButton
            title={t('inventory.applyAdjustment')}
            loading={saving}
            disabled={!selectedItemId || !delta.trim() || !reason.trim()}
            onPress={() => void adjust()}
          />
        </Card>
      ) : null}

      {canManage ? (
        <Card>
          <Text style={styles.formTitle}>{t('inventory.addItem')}</Text>
          <FormField label={t('inventory.item')} value={name} onChangeText={setName} />
          <FormField label={t('inventory.unit')} value={unit} onChangeText={setUnit} />
          <FormField
            label={t('inventory.minimum')}
            value={minimumLevel}
            onChangeText={setMinimumLevel}
            keyboardType="decimal-pad"
          />
          <Text style={styles.fieldLabel}>{t('inventory.category')}</Text>
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
          <Text style={styles.link} onPress={() => setShowCategoryForm((value) => !value)}>
            {t('inventory.addCategory')}
          </Text>
          {showCategoryForm ? (
            <View>
              <FormField
                label={t('inventory.categoryName')}
                value={categoryName}
                onChangeText={setCategoryName}
              />
              <AppButton
                title={t('common.save')}
                variant="secondary"
                loading={saving}
                onPress={() => void addCategory()}
              />
            </View>
          ) : null}
          <FormField
            label={t('inventory.openingQuantity')}
            value={openingQuantity}
            onChangeText={setOpeningQuantity}
            keyboardType="decimal-pad"
          />
          <FormField
            label={t('inventory.openingCost', { currency })}
            value={openingCost}
            onChangeText={setOpeningCost}
            keyboardType="decimal-pad"
          />
          <AppButton
            title={t('inventory.addItem')}
            loading={saving}
            disabled={!name.trim() || !unit.trim() || !categoryId}
            onPress={() => void addItem()}
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
  link: {
    color: '#0F5132',
    fontWeight: '700',
    marginBottom: 12,
  },
});
