import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@rbm/shared';

import { Text, View } from '@/components/Themed';
import { AppButton } from '@/src/components/AppButton';
import { Chip } from '@/src/components/Chip';
import { FormField } from '@/src/components/FormField';
import { Screen } from '@/src/components/Screen';
import { Card, EmptyText, ErrorBanner, LoadingBlock, Row } from '@/src/components/ui';
import {
  createRecipe,
  listInventoryItems,
  listRecipes,
  type InventoryItem,
  type Recipe,
} from '@/src/api/business';
import { useAuth } from '@/src/auth/AuthProvider';
import { useRestaurantId } from '@/src/hooks/useRestaurantId';

type DraftIngredient = {
  inventoryItemId: string;
  name: string;
  quantity: string;
  unit: string;
};

export default function RecipeScreen() {
  const { t } = useTranslation();
  const restaurantId = useRestaurantId();
  const { activeMembership } = useAuth();
  const currency = activeMembership?.restaurant.currency ?? 'MWK';
  const params = useLocalSearchParams<{ productId: string }>();
  const productId = params.productId;
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [draft, setDraft] = useState<DraftIngredient[]>([]);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [yieldQuantity, setYieldQuantity] = useState('1');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!restaurantId || !productId) return;
    setLoading(true);
    setError(null);
    try {
      const [recipes, inventoryPage] = await Promise.all([
        listRecipes(restaurantId, productId),
        listInventoryItems(restaurantId),
      ]);
      const active = recipes.find((entry) => entry.isActive) ?? recipes[0] ?? null;
      setRecipe(active);
      setItems(inventoryPage.items);
      setSelectedItemId((current) => current || inventoryPage.items[0]?.id || '');
      if (active) {
        setYieldQuantity(active.yieldQuantity);
        setNotes(active.notes ?? '');
      }
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [restaurantId, productId]);

  function startNewVersion() {
    if (!recipe) return;
    setDraft(
      recipe.ingredients.map((ingredient) => ({
        inventoryItemId: ingredient.inventoryItemId,
        name: ingredient.name,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
      }))
    );
    setNotes(recipe.notes ?? '');
    setYieldQuantity(recipe.yieldQuantity);
  }

  function addIngredient() {
    const item = items.find((entry) => entry.id === selectedItemId);
    if (!item || !quantity.trim()) return;
    setDraft((current) => [
      ...current.filter((line) => line.inventoryItemId !== item.id),
      {
        inventoryItemId: item.id,
        name: item.name,
        quantity: quantity.trim(),
        unit: item.unit,
      },
    ]);
    setQuantity('1');
  }

  async function save() {
    if (!restaurantId || !productId || draft.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createRecipe(restaurantId, {
        productId,
        yieldQuantity: yieldQuantity.trim() || '1',
        notes: notes.trim() || undefined,
        ingredients: draft.map((line) => ({
          inventoryItemId: line.inventoryItemId,
          quantity: line.quantity,
          unit: line.unit,
        })),
      });
      setRecipe(created);
      setDraft([]);
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Screen>
        <LoadingBlock label={t('common.loading')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.title}>{t('recipes.title')}</Text>
      {error ? <ErrorBanner message={error} /> : null}

      {recipe ? (
        <Card>
          <Text style={styles.cardTitle}>
            {t('recipes.version', { version: recipe.version })}
          </Text>
          <Row
            label={t('recipes.cost')}
            value={formatMoney(BigInt(recipe.costPerYieldUnitMinor), currency)}
          />
          <Row
            label={t('products.price', { currency })}
            value={formatMoney(BigInt(recipe.sellingPriceMinor), currency)}
          />
          <Row
            label={t('recipes.margin')}
            value={formatMoney(BigInt(recipe.grossMarginMinor), currency)}
          />
          {recipe.ingredients.map((ingredient) => (
            <Row
              key={ingredient.id}
              label={`${ingredient.name} (${ingredient.quantity} ${ingredient.unit})`}
              value={formatMoney(BigInt(ingredient.costMinor), currency)}
            />
          ))}
          <AppButton
            title={t('recipes.newVersion')}
            variant="secondary"
            onPress={startNewVersion}
          />
        </Card>
      ) : (
        <EmptyText>{t('recipes.empty')}</EmptyText>
      )}

      <Card>
        <Text style={styles.cardTitle}>
          {recipe ? t('recipes.newVersion') : t('recipes.create')}
        </Text>
        <FormField
          label={t('recipes.yield')}
          value={yieldQuantity}
          onChangeText={setYieldQuantity}
          keyboardType="decimal-pad"
        />
        <FormField
          label={t('common.notes')}
          value={notes}
          onChangeText={setNotes}
        />
        <Text style={styles.fieldLabel}>{t('recipes.ingredient')}</Text>
        <View style={styles.chips}>
          {items.map((item) => (
            <Chip
              key={item.id}
              label={`${item.name} (${item.unit})`}
              selected={item.id === selectedItemId}
              onPress={() => setSelectedItemId(item.id)}
            />
          ))}
        </View>
        <FormField
          label={t('common.quantity')}
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="decimal-pad"
        />
        <AppButton
          title={t('recipes.addIngredient')}
          variant="secondary"
          onPress={addIngredient}
        />

        {draft.length > 0 ? (
          <View style={styles.draft}>
            {draft.map((line) => (
              <View key={line.inventoryItemId} style={styles.draftRow}>
                <Text style={styles.draftText}>
                  {line.name} · {line.quantity} {line.unit}
                </Text>
                <Pressable
                  onPress={() =>
                    setDraft((current) =>
                      current.filter(
                        (entry) => entry.inventoryItemId !== line.inventoryItemId
                      )
                    )
                  }
                >
                  <Text style={styles.remove}>{t('common.remove')}</Text>
                </Pressable>
              </View>
            ))}
            <AppButton
              title={t('recipes.saveVersion')}
              loading={saving}
              onPress={() => void save()}
            />
          </View>
        ) : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
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
  draft: {
    marginTop: 12,
    gap: 10,
  },
  draftRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  draftText: {
    flex: 1,
    fontSize: 14,
  },
  remove: {
    color: '#B42318',
    fontWeight: '700',
  },
});
