import i18n from "i18next";
import { initReactI18next } from "react-i18next";

i18n.use(initReactI18next).init({
  fallbackLng: "en",
  resources: {
    en: {
      translation: {
        appName: "TarsDB",
      },
    },
    "pt-BR": {
      translation: {
        appName: "TarsDB",
      },
    },
  },
});
