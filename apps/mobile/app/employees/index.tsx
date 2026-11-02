import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text, View } from '@/components/Themed';
import {
  ApiError,
  createMember,
  listMembers,
  listRolesAndPermissions,
  type Member,
  type RoleDefinition,
} from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { Chip } from '@/src/components/Chip';
import { FormField } from '@/src/components/FormField';
import { Screen } from '@/src/components/Screen';

type StatusFilter = 'ALL' | 'ACTIVE' | 'SUSPENDED' | 'REMOVED';

function statusColor(status: string) {
  if (status === 'ACTIVE') return '#067647';
  if (status === 'SUSPENDED') return '#B54708';
  return '#667085';
}

export default function EmployeesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { activeMembership, hasPermission } = useAuth();
  const canManage = hasPermission('employees.manage');
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [showForm, setShowForm] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roleKey, setRoleKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const restaurantId = activeMembership?.restaurant.id;
  const isOwner = activeMembership?.role.key === 'OWNER';

  const loadData = useCallback(async () => {
    if (!restaurantId) return;

    setError(null);

    try {
      const [nextMembers, roleData] = await Promise.all([
        listMembers(restaurantId),
        listRolesAndPermissions(restaurantId),
      ]);

      setMembers(nextMembers);
      setRoles(roleData.roles);
      setRoleKey((current) => {
        if (current) return current;
        const cashier = roleData.roles.find((role) => role.key === 'CASHIER');
        return cashier?.key ?? roleData.roles[0]?.key ?? '';
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : t('errors.generic')
      );
    } finally {
      setLoading(false);
    }
  }, [restaurantId, t]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  const availableRoles = useMemo(
    () => roles.filter((role) => isOwner || role.key !== 'OWNER'),
    [roles, isOwner]
  );

  const filteredMembers = useMemo(() => {
    const term = search.trim().toLowerCase();

    return members.filter((member) => {
      if (filter !== 'ALL' && member.status !== filter) {
        return false;
      }

      if (!term) {
        return true;
      }

      return (
        member.user.fullName.toLowerCase().includes(term) ||
        member.user.phone.includes(term) ||
        (member.user.email ?? '').toLowerCase().includes(term)
      );
    });
  }, [members, filter, search]);

  async function handleCreate() {
    if (!restaurantId) return;

    setSubmitting(true);
    setFormError(null);

    try {
      await createMember(restaurantId, {
        fullName: fullName.trim(),
        phone: phone.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        roleKey,
        ...(password ? { password } : {}),
      });

      setFullName('');
      setPhone('');
      setEmail('');
      setPassword('');
      setShowForm(false);
      await loadData();
    } catch (createError) {
      if (createError instanceof ApiError && Array.isArray(createError.details)) {
        const messages = createError.details
          .filter(
            (detail): detail is { field: string; message: string } =>
              Boolean(detail) &&
              typeof detail === 'object' &&
              'message' in detail &&
              typeof (detail as { message?: unknown }).message === 'string'
          )
          .map((detail) => detail.message);

        setFormError(messages[0] ?? createError.message);
      } else {
        setFormError(
          createError instanceof Error
            ? createError.message
            : t('errors.generic')
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{t('employees.title')}</Text>
          <Text style={styles.subtitle}>{activeMembership?.restaurant.name}</Text>
        </View>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>{t('common.back')}</Text>
        </Pressable>
      </View>

      <FormField
        label={t('employees.search')}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
      />

      <View style={styles.chips}>
        {(['ALL', 'ACTIVE', 'SUSPENDED', 'REMOVED'] as StatusFilter[]).map(
          (status) => (
            <Chip
              key={status}
              label={
                status === 'ALL'
                  ? t('common.all')
                  : t(`employees.${status.toLowerCase()}`)
              }
              selected={filter === status}
              onPress={() => setFilter(status)}
            />
          )
        )}
      </View>

      {canManage ? (
        <View style={styles.addSection}>
          <AppButton
            title={showForm ? t('common.cancel') : t('employees.add')}
            variant="secondary"
            onPress={() => setShowForm((current) => !current)}
          />
        </View>
      ) : null}

      {showForm && canManage ? (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>{t('employees.add')}</Text>
          <Text style={styles.formHint}>{t('employees.addHint')}</Text>
          <FormField
            label={t('auth.fullName')}
            value={fullName}
            onChangeText={setFullName}
          />
          <FormField
            label={t('auth.phone')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          <FormField
            label={`${t('auth.email')} (${t('common.optional')})`}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <FormField
            label={`${t('auth.password')} (${t('common.optional')})`}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <Text style={styles.label}>{t('employees.role')}</Text>
          <View style={styles.chips}>
            {availableRoles.map((role) => (
              <Chip
                key={role.key}
                label={role.name}
                selected={roleKey === role.key}
                onPress={() => setRoleKey(role.key)}
              />
            ))}
          </View>
          {formError ? <Text style={styles.error}>{formError}</Text> : null}
          <AppButton
            title={t('employees.create')}
            loading={submitting}
            onPress={() => void handleCreate()}
          />
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator style={styles.loading} />
      ) : error ? (
        <View style={styles.errorCard}>
          <Text style={styles.error}>{error}</Text>
          <AppButton
            title={t('common.retry')}
            variant="secondary"
            onPress={() => void loadData()}
          />
        </View>
      ) : filteredMembers.length === 0 ? (
        <Text style={styles.empty}>{t('employees.empty')}</Text>
      ) : (
        <View style={styles.list}>
          {filteredMembers.map((member) => (
            <Pressable
              key={member.id}
              onPress={() => router.push(`/employees/${member.id}`)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <View style={styles.rowMain}>
                <Text style={styles.name}>{member.user.fullName}</Text>
                <Text style={styles.detail}>
                  {member.role.name} · {member.user.phone}
                </Text>
              </View>
              <Text style={[styles.status, { color: statusColor(member.status) }]}>
                {t(`employees.${member.status.toLowerCase()}`)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    opacity: 0.65,
  },
  link: {
    color: '#0F5132',
    fontWeight: '700',
    paddingTop: 4,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  addSection: {
    marginBottom: 16,
  },
  formCard: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  formTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  formHint: {
    marginTop: 6,
    marginBottom: 14,
    fontSize: 13,
    opacity: 0.7,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  error: {
    color: '#B42318',
    fontSize: 14,
    marginBottom: 10,
  },
  loading: {
    marginTop: 24,
  },
  errorCard: {
    gap: 12,
  },
  empty: {
    marginTop: 24,
    textAlign: 'center',
    opacity: 0.65,
  },
  list: {
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowMain: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
  },
  detail: {
    marginTop: 3,
    fontSize: 13,
    opacity: 0.7,
  },
  status: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
});
