import { Platform } from "react-native";

const fallbackBaseUrl =
  Platform.OS === "android"
    ? "http://10.0.2.2:4000/api/v1"
    : "http://localhost:4000/api/v1";

export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? fallbackBaseUrl).replace(
  /\/$/,
  ""
);
