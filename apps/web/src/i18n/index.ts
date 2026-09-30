import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// 导入语言包
import zhCNCommon from './locales/zh-CN/common.json'
import zhCNAuth from './locales/zh-CN/auth.json'
import zhCNBookmarks from './locales/zh-CN/bookmarks.json'
import zhCNTags from './locales/zh-CN/tags.json'
import zhCNSettingsBasic from './locales/zh-CN/settings/basic.json'
import zhCNSettingsBrowser from './locales/zh-CN/settings/browser.json'
import zhCNSettingsCore from './locales/zh-CN/settings/core.json'
import zhCNSettingsData from './locales/zh-CN/settings/data.json'
import zhCNSettingsLanguage from './locales/zh-CN/settings/language.json'
import zhCNSettingsWorkspace from './locales/zh-CN/settings/workspace.json'
import zhCNSettingsPublicShare from './locales/zh-CN/settings/public-share.json'
import zhCNSettingsSyncHealth from './locales/zh-CN/settings/sync-health.json'
import zhCNSettingsApi from './locales/zh-CN/settings/api.json'
import zhCNTabGroupsCore from './locales/zh-CN/tabGroups/core.json'
import zhCNTabGroupsOrganization from './locales/zh-CN/tabGroups/organization.json'
import zhCNTabGroupsViews from './locales/zh-CN/tabGroups/views.json'

import enCommon from './locales/en/common.json'
import enAuth from './locales/en/auth.json'
import enBookmarks from './locales/en/bookmarks.json'
import enTags from './locales/en/tags.json'
import enSettingsBasic from './locales/en/settings/basic.json'
import enSettingsBrowser from './locales/en/settings/browser.json'
import enSettingsCore from './locales/en/settings/core.json'
import enSettingsData from './locales/en/settings/data.json'
import enSettingsLanguage from './locales/en/settings/language.json'
import enSettingsWorkspace from './locales/en/settings/workspace.json'
import enSettingsPublicShare from './locales/en/settings/public-share.json'
import enSettingsSyncHealth from './locales/en/settings/sync-health.json'
import enSettingsApi from './locales/en/settings/api.json'
import enTabGroupsCore from './locales/en/tabGroups/core.json'
import enTabGroupsOrganization from './locales/en/tabGroups/organization.json'
import enTabGroupsViews from './locales/en/tabGroups/views.json'

// 支持的语言列表
export const supportedLanguages = [
  { code: 'zh-CN', name: '简体中文', nativeName: '简体中文' },
  { code: 'en', name: 'English', nativeName: 'English' }
] as const

// 注意:此处用浅层 spread 合并多个 settings JSON。若两个文件存在同名顶层键,
// 后者会整体覆盖前者。新增文件时请确保顶层键唯一(导航标签统一放 core.json 的 tabs,
// 各特性文案用各自命名空间如 api./browser./data.)。
const zhCNSettings = {
  ...zhCNSettingsCore,
  ...zhCNSettingsLanguage,
  ...zhCNSettingsWorkspace,
  ...zhCNSettingsData,
  ...zhCNSettingsBrowser,
  ...zhCNSettingsBasic,
  ...zhCNSettingsApi,
  ...zhCNSettingsPublicShare,
  ...zhCNSettingsSyncHealth,
}

const enSettings = {
  ...enSettingsCore,
  ...enSettingsLanguage,
  ...enSettingsWorkspace,
  ...enSettingsData,
  ...enSettingsBrowser,
  ...enSettingsBasic,
  ...enSettingsApi,
  ...enSettingsPublicShare,
  ...enSettingsSyncHealth,
}

const zhCNTabGroups = {
  ...zhCNTabGroupsCore,
  ...zhCNTabGroupsViews,
  ...zhCNTabGroupsOrganization,
}

const enTabGroups = {
  ...enTabGroupsCore,
  ...enTabGroupsViews,
  ...enTabGroupsOrganization,
}

// 资源配置
const resources = {
  'zh-CN': {
    common: zhCNCommon,
    auth: zhCNAuth,
    tabGroups: zhCNTabGroups,
    bookmarks: zhCNBookmarks,
    tags: zhCNTags,
    settings: zhCNSettings,
  },
  en: {
    common: enCommon,
    auth: enAuth,
    tabGroups: enTabGroups,
    bookmarks: enBookmarks,
    tags: enTags,
    settings: enSettings,
  }
}

// 初始化 i18n
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'zh-CN',
    defaultNS: 'common',
    ns: ['common', 'auth', 'tabGroups', 'bookmarks', 'tags', 'settings'],

    detection: {
      // 语言检测顺序：localStorage -> 浏览器语言
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'tmarks-language',
      caches: ['localStorage']
    },

    interpolation: {
      escapeValue: false // React 已经处理了 XSS
    },

    react: {
      useSuspense: false
    }
  })

// 语言切换同步到 DOM:html lang 与 document.title 都是读屏与标签页的可见面,
// 之前永远停在静态中文,英文用户看到的是错误语言。
i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng === 'zh-CN' ? 'zh-CN' : 'en'
})

export default i18n
