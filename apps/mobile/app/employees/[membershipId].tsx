import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text, View } from '@/components/Themed';
import {
  getMember,
  listRolesAndPermissions,
  removeMember,
  updateMember,
  type Member,
  type PermissionDefinition,
  type RoleDefinition,
} from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { Chip } from '@/src/components/Chip';
import { Screen } from '@/src/components/Screen';

export default function EmployeeDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { membershipId } = useLocalSearchParams<{ membershipId: string }>();
  const { activeMembership, hasPermission } = useAuth();
  const restaurantId = activeMembership?.restaurant.id;
  const canManage = hasPermission('employees.manage');
  const [member, setMember] = useState<Member | null>(null);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [permissionDefinitions, setPermissionDefinitions] = useState<
    PermissionDefinition[]
  >([]);
  const [overrides, setOverrides] = useState<Record<string, 'ALLOW' | 'DENY'>>(
    {}
  );
  const [selectedRole, setSelectedRole] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<'ACTIVE' | 'SUSPENDED'>(
    'ACTIVE'
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!restaurantId || !membershipId) return;

    setError(null);

    try {
      const [nextMember, roleData] = await Promise.all([
        getMember(restaurantId, membershipId),
        listRolesAndPermissions(restaurantId),
      ]);

      setMember(nextMember);
      setSelectedRole(nextMember.role.key);
      setSelectedStatus(
        nextMember.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE'
      );
      setRoles(roleData.roles);
      setPermissionDefinitions(roleData.permissions);
      setOverrides(
        Object.fromEntries(
          nextMember.permissionOverrides.map((override) => [
            override.key,
            override.effect,
          ])
        )
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : t('errors.generic')
      );
    } finally {
      setLoading(false);
    }
  }, [restaurantId, membershipId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const isOwnerActor = activeMembership?.role.key === 'OWNER';
  const availableRoles = useMemo(
    () => roles.filter((role) => isOwnerActor || role.key !== 'OWNER'),
    [roles, isOwnerActor]
  );

  function setOverride(key: string, effect: 'ALLOW' | 'DENY' | null) {
    setOverrides((current) => {
      const next = { ...current };

      if (effect) {
        next[key] = effect;
      } else {
        delete next[key];
      }

      return next;
    });
  }

  async function handleSave() {
    if (!restaurantId || !member) return;

    const originalOverrides = Object.fromEntries(
      member.permissionOverrides.map((override) => [
        override.key,
        override.effect,
      ])
    );
    const overridesChanged =
      Object.keys(overrides).length !== Object.keys(originalOverrides).length ||
      Object.entries(overrides).some(
        ([key, effect]) => originalOverrides[key] !== effect
      );

    const changes = {
      ...(selectedRole !== member.role.key ? { roleKey: selectedRole } : {}),
      ...(selectedStatus !== member.status &&
      (selectedStatus === 'ACTIVE' || selectedStatus === 'SUSPENDED')
        ? { status: selectedStatus }
        : {}),
      ...(overridesChanged
        ? {
            permissionOverrides: Object.entries(overrides).map(
              ([key, effect]) => ({ key, effect })
            ),
          }
        : {}),
    };

    if (Object.keys(changes).length === 0) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const updated = await updateMember(restaurantId, member.id, changes);

      setMember(updated);
      setSelectedRole(updated.role.key);
      setSelectedStatus(updated.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE');
      setOverrides(
        Object.fromEntries(
          updated.permissionOverrides.map((override) => [
            override.key,
            override.effect,
          ])
        )
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : t('errors.generic')
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!restaurantId || !member) return;

    setRemoving(true);
    setError(null);

    try {
      await removeMember(restaurantId, member.id);
      router.back();
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : t('errors.generic')
      );
    } finally {
      setRemoving(false);
    }
  }

  if (loading) {
    return (
      <Screen scroll={false} contentStyle={styles.centered}>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!member) {
    return (
      <Screen>
        <Text style={styles.error}>{error ?? t('errors.generic')}</Text>
        <AppButton
          title={t('common.back')}
          variant="secondary"
          onPress={() => router.back()}
        />
      </Screen>
    );
  }

  const isRemoved = member.status === 'REMOVED';

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{member.user.fullName}</Text>
          <Text style={styles.subtitle}>{member.user.phone}</Text>
          {member.user.email ? (
            <Text style={styles.subtitle}>{member.user.email}</Text>
          ) : null}
        </View>
        <Text style={styles.backLink} onPress={() => router.back()}>
          {t('common.back')}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('employees.details')}</Text>
        <Text style={styles.detail}>
          {t('settings.role')}: {member.role.name}
        </Text>
        <Text style={styles.detail}>
          {t('employees.status')}: {t(`employees.${member.status.toLowerCase()}`)}
        </Text>
        <Text style={styles.detail}>
          {t('employees.created')}: {new Date(member.joinedAt).toLocaleDateString()}
        </Text>
        {member.user.mustChangePassword ? (
          <Text style={styles.warning}>{t('employees.mustChangePassword')}</Text>
        ) : null}
      </View>

      {canManage && !isRemoved ? (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('employees.role')}</Text>
            <View style={styles.chips}>
              {availableRoles.map((role) => (
                <Chip
                  key={role.key}
                  label={role.name}
                  selected={selectedRole === role.key}
                  onPress={() => setSelectedRole(role.key)}
                />
              ))}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('employees.status')}</Text>
            <View style={styles.chips}>
              <Chip
                label={t('employees.active')}
                selected={selectedStatus === 'ACTIVE'}
                onPress={() => setSelectedStatus('ACTIVE')}
              />
              <Chip
                label={t('employees.suspended')}
                selected={selectedStatus === 'SUSPENDED'}
                onPress={() => setSelectedStatus('SUSPENDED')}
              />
            </View>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            <AppButton
              title={t('employees.saveChanges')}
              loading={saving}
              onPress={() => void handleSave()}
            />
            <AppButton
              title={t('employees.remove')}
              variant="danger"
              loading={removing}
              onPress={() =>
                Alert.alert(
                  t('employees.remove'),
                  t('employees.removeConfirm', {
                    name: member.user.fullName,
                  }),
                  [
                    { text: t('common.cancel'), style: 'cancel' },
                    {
                      text: t('employees.remove'),
                      style: 'destructive',
                      onPress: () => void handleRemove(),
                    },
                  ]
                )
              }
            />
          </View>
        </>
      ) : null}

      {canManage && !isRemoved ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('employees.permissionOverrides')}</Text>
          <Text style={styles.hint}>{t('employees.permissionOverridesHint')}</Text>
          {[...new Set(permissionDefinitions.map((permission) => permission.module))].map(
            (module) => (
              <View key={module} style={styles.permissionGroup}>
                <Text style={styles.moduleTitle}>{module}</Text>
                {permissionDefinitions
                  .filter((permission) => permission.module === module)
                  .map((permission) => {
                    const current = overrides[permission.key] ?? null;

                    return (
                      <View key={permission.key} style={styles.permissionRow}>
                        <Text style={styles.permissionKey}>{permission.key}</Text>
                        <View style={styles.overrideRow}>
                          {(
                            [
                              [null, t('employees.inherit')],
                              ['ALLOW', t('employees.allow')],
                              ['DENY', t('employees.deny')],
                            ] as const
                          ).map(([effect, label]) => (
                            <Pressable
                              key={String(effect)}
                              onPress={() => setOverride(permission.key, effect)}
                              style={[
                                styles.overrideChip,
                                current === effect && styles.overrideChipSelected,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.overrideText,
                                  current === effect && styles.overrideTextSelected,
                                ]}
                              >
                                {label}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    );
                  })}
              </View>
            )
          )}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('employees.permissions')}</Text>
          <View style={styles.chips}>
            {member.permissions.map((permission) => (
              <Chip key={permission} label={permission} />
            ))}
          </View>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    opacity: 0.7,
  },
  backLink: {
    color: '#0F5132',
    fontWeight: '700',
    paddingTop: 4,
  },
  card: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    opacity: 0.6,
    marginBottom: 10,
  },
  detail: {
    fontSize: 14,
    marginBottom: 4,
  },
  warning: {
    marginTop: 8,
    fontSize: 13,
    color: '#B54708',
    fontWeight: '600',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actions: {
    gap: 10,
    marginBottom: 16,
  },
  error: {
    color: '#B42318',
    fontSize: 14,
    marginBottom: 12,
  },
  hint: {
    fontSize: 13,
    opacity: 0.7,
    marginBottom: 14,
  },
  permissionGroup: {
    marginBottom: 14,
  },
  moduleTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
    textTransform: 'capitalize',
  },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  permissionKey: {
    flex: 1,
    fontSize: 13,
  },
  overrideRow: {
    flexDirection: 'row',
    gap: 4,
  },
  overrideChip: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  overrideChipSelected: {
    backgroundColor: '#0F5132',
    borderColor: '#0F5132',
  },
  overrideText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#344054',
  },
  overrideTextSelected: {
    color: '#FFFFFF',
  },
});
