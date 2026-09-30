import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ThemePreference } from '@/shared/theme-types'

interface ThemeState {
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: 'system',
      setPreference: (preference) => set({ preference }),
    }),
    { name: 'theme-storage' },
  ),
)
