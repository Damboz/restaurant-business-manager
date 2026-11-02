import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMoney, parseMoneyToMinor } from '@rbm/shared';

import { Text, View } from '@/components/Themed';
import { AppButton } from '@/src/components/AppButton';
import { Chip } from '@/src/components/Chip';
import { FormField } from '@/src/components/FormField';
import { Screen } from '@/src/components/Screen';
import { Card, ErrorBanner, LoadingBlock, Row } from '@/src/components/ui';
import {
  getProduct,
  listProductCategories,
  updateProduct,
  type Product,
  type ProductCategory,
} from '@/src/api/business';
import { useAuth } from '@/src/auth/AuthProvider';
import { useRestaurantId } from '@/src/hooks/useRestaurantId';

export default function ProductDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const restaurantId = useRestaurantId();
  const { activeMembership, hasPermission } = useAuth();
  const currency = activeMembership?.restaurant.currency ?? 'MWK';
  const params = useLocalSearchParams<{ productId: string }>();
  const productId = params.productId;
  const canManage = hasPermission('products.manage');
  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [recipeBased, setRecipeBased] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!restaurantId || !productId) return;
    let active = true;
    setLoading(true);

    Promise.all([
      getProduct(restaurantId, productId),
      listProductCategories(restaurantId),
    ])
      .then(([loadedProduct, categoryList]) => {
        if (!active) return;
        setProduct(loadedProduct);
        setCategories(categoryList);
        setName(loadedProduct.name);
        setDescription(loadedProduct.description ?? '');
        setPrice(
          (Number(loadedProduct.sellingPriceMinor) / 100).toFixed(2)
        );
        setCategoryId(loadedProduct.categoryId);
        setStatus(loadedProduct.status);
        setRecipeBased(loadedProduct.isRecipeBased);
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
  }, [restaurantId, productId]);

  async function save() {
    if (!restaurantId || !productId) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateProduct(restaurantId, productId, {
        name: name.trim(),
        description: description.trim() || null,
        categoryId,
        sellingPriceMinor: parseMoneyToMinor(price, currency).toString(),
        status,
        isRecipeBased: recipeBased,
      });
      setProduct(updated);
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

  if (!product) {
    return (
      <Screen>
        <ErrorBanner message={error ?? t('common.notFound')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.title}>{product.name}</Text>
      {error ? <ErrorBanner message={error} /> : null}

      <Card>
        <Row
          label={t('products.price', { currency })}
          value={formatMoney(BigInt(product.sellingPriceMinor), currency)}
        />
        <Row label={t('products.category')} value={product.categoryName} />
        <Row label={t('common.status')} value={status} />
      </Card>

      {canManage ? (
        <Card>
          <Text style={styles.formTitle}>{t('common.edit')}</Text>
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
          <Text style={styles.fieldLabel}>{t('common.status')}</Text>
          <View style={styles.chips}>
            <Chip
              label={t('common.active')}
              selected={status === 'ACTIVE'}
              onPress={() => setStatus('ACTIVE')}
            />
            <Chip
              label={t('common.inactive')}
              selected={status === 'INACTIVE'}
              onPress={() => setStatus('INACTIVE')}
            />
            <Chip
              label={t('products.recipeBased')}
              selected={recipeBased}
              onPress={() => setRecipeBased((value) => !value)}
            />
          </View>
          <AppButton title={t('common.save')} loading={saving} onPress={() => void save()} />
        </Card>
      ) : null}

      {product.isRecipeBased ? (
        <AppButton
          title={t('recipes.manage')}
          variant="secondary"
          onPress={() => router.push(`/recipes/${product.id}`)}
        />
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
