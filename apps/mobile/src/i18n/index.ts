import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import ny from "./locales/ny.json";

export const resources = {
  en: { translation: en },
  ny: { translation: ny }
} as const;

export type AppLanguage = keyof typeof resources;

export const DEFAULT_LANGUAGE: AppLanguage = "en";

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: ["en", "ny"],
    interpolation: {
      escapeValue: false
    }
  });
}

export default i18n;
