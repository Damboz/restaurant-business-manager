import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const memoryStore = new Map<string, string>();

function webStorage(): Storage | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  return localStorage;
}

export async function getStoredItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return webStorage()?.getItem(key) ?? memoryStore.get(key) ?? null;
  }

  return SecureStore.getItemAsync(key);
}

export async function setStoredItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    const storage = webStorage();

    if (storage) {
      storage.setItem(key, value);
      return;
    }

    memoryStore.set(key, value);
    return;
  }

  await SecureStore.setItemAsync(key, value);
}

export async function deleteStoredItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    webStorage()?.removeItem(key);
    memoryStore.delete(key);
    return;
  }

  await SecureStore.deleteItemAsync(key);
}
