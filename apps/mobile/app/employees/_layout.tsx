import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { View } from '@/components/Themed';
import { useAuth } from '@/src/auth/AuthProvider';

export default function EmployeesLayout() {
  const { status, hasPermission } = useAuth();

  if (status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  if (status === 'guest') {
    return <Redirect href="/login" />;
  }

  if (!hasPermission('employees.view') && !hasPermission('employees.manage')) {
    return <Redirect href="/" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
