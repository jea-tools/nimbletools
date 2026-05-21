import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enUS from './locales/en-US.json';
import zhCN from './locales/zh-CN.json';

const LANGUAGE_STORAGE_KEY = 'nimbletools-language';
const savedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY) || 'en-US';

i18n.use(initReactI18next).init({
  resources: {
    'en-US': { translation: enUS },
    'zh-CN': { translation: zhCN },
  },
  lng: savedLanguage,
  fallbackLng: 'en-US',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
});

export default i18n;
