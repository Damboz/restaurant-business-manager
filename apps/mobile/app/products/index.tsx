import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMoney, parseMoneyToMinor } from '@rbm/shared';

import { Text, View } from '@/components/Themed';
import { AppButton } from '@/src/components/AppButton';
import { Chip } from '@/src/components/Chip';
import { FormField } from '@/src/components/FormField';
import { Screen } from '@/src/components/Screen';
import { Card, EmptyText, ErrorBanner, LoadingBlock, Pill } from '@/src/components/ui';
import {
  createProduct,
  createProductCategory,
  listProductCategories,
  listProducts,
  type Product,
  type ProductCategory,
} from '@/src/api/business';
import { useAuth } from '@/src/auth/AuthProvider';
import { useRestaurantId } from '@/src/hooks/useRestaurantId';

export default function ProductsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const restaurantId = useRestaurantId();
  const { activeMembership, hasPermission } = useAuth();
  const currency = activeMembership?.restaurant.currency ?? 'MWK';
  const canManage = hasPermission('products.manage');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [recipeBased, setRecipeBased] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!restaurantId) return;
    setLoading(true);
    setError(null);
    try {
      const [productPage, categoryList] = await Promise.all([
        listProducts(restaurantId, { search: search || undefined }),
        listProductCategories(restaurantId),
      ]);
      setProducts(productPage.items);
      setCategories(categoryList);
      if (!categoryId && categoryList[0]) setCategoryId(categoryList[0].id);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [restaurantId]);

  async function addCategory() {
    if (!restaurantId || !categoryName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createProductCategory(restaurantId, { name: categoryName.trim() });
      setCategoryName('');
      setShowCategoryForm(false);
      await load();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function addProduct() {
    if (!restaurantId || !name.trim() || !price.trim() || !categoryId) return;
    setSaving(true);
    setError(null);
    try {
      await createProduct(restaurantId, {
        categoryId,
        name: name.trim(),
        description: description.trim() || undefined,
        sellingPriceMinor: parseMoneyToMinor(price, currency).toString(),
        isRecipeBased: recipeBased,
      });
      setName('');
      setPrice('');
      setDescription('');
      setRecipeBased(false);
      await load();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.title}>{t('products.title')}</Text>
      <View style={styles.searchRow}>
        <View style={styles.searchInput}>
          <FormField
            label={t('common.search')}
            value={search}
            onChangeText={setSearch}
            placeholder={t('products.searchPlaceholder')}
            returnKeyType="search"
            onSubmitEditing={() => void load()}
          />
        </View>
        <AppButton title={t('common.search')} variant="secondary" onPress={() => void load()} />
      </View>

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingBlock label={t('common.loading')} /> : null}

      {!loading && products.length === 0 ? (
        <EmptyText>{t('products.empty')}</EmptyText>
      ) : null}

      {products.map((product) => (
        <Card key={product.id}>
          <View style={styles.cardHeader}>
            <Pressable
              style={styles.cardTitleArea}
              onPress={() => router.push(`/products/${product.id}`)}
            >
              <Text style={styles.name}>{product.name}</Text>
              <Text style={styles.meta}>
                {product.categoryName} · {formatMoney(BigInt(product.sellingPriceMinor), currency)}
              </Text>
            </Pressable>
            <Pill
              label={
                product.status === 'ACTIVE'
                  ? t('common.active')
                  : t('common.inactive')
              }
              tone={product.status === 'ACTIVE' ? 'positive' : 'neutral'}
            />
          </View>
          <View style={styles.cardActions}>
            <AppButton
              title={t('products.details')}
              variant="secondary"
              onPress={() => router.push(`/products/${product.id}`)}
            />
            {product.isRecipeBased && canManage ? (
              <AppButton
                title={t('recipes.title')}
                variant="ghost"
                onPress={() => router.push(`/recipes/${product.id}`)}
              />
            ) : null}
          </View>
        </Card>
      ))}

      {canManage ? (
        <Card>
          <Text style={styles.formTitle}>{t('products.addProduct')}</Text>
          <FormField label={t('products.name')} value={name} onChangeText={setName} />
          <FormField
            label={t('products.price', { currency })}
            value={price}
            onChangeText={setPrice}
            keyboardType="decimal-pad"
          />
          <FormField
            label={t('common.description')}
            value={description}
            onChangeText={setDescription}
          />
          <Text style={styles.fieldLabel}>{t('products.category')}</Text>
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
          <Pressable onPress={() => setShowCategoryForm((value) => !value)}>
            <Text style={styles.link}>{t('products.addCategory')}</Text>
          </Pressable>
          {showCategoryForm ? (
            <View style={styles.inlineForm}>
              <FormField
                label={t('products.categoryName')}
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
          <View style={styles.chips}>
            <Chip
              label={t('products.recipeBased')}
              selected={recipeBased}
              onPress={() => setRecipeBased((value) => !value)}
            />
          </View>
          <AppButton
            title={t('products.addProduct')}
            loading={saving}
            disabled={!name.trim() || !price.trim() || !categoryId}
            onPress={() => void addProduct()}
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
    marginBottom: 18,
  },
  searchRow: {
    gap: 8,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardTitleArea: {
    flex: 1,
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
  },
  meta: {
    marginTop: 4,
    fontSize: 14,
    opacity: 0.7,
  },
  cardActions: {
    gap: 8,
    marginTop: 12,
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
  link: {
    color: '#0F5132',
    fontWeight: '700',
    marginBottom: 12,
  },
  inlineForm: {
    marginBottom: 8,
  },
});
