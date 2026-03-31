import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  isAuthenticated: boolean;
  userEmail: string;
  login: (email: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      userEmail: '',
      login: (email: string) => set({ isAuthenticated: true, userEmail: email }),
      logout: () => set({ isAuthenticated: false, userEmail: '' }),
    }),
    {
      name: 'finance-auth',
    }
  )
);
