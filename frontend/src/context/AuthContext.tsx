import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { User, LoginResponse } from '../types';
import { api } from '../api/client';

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount, check localStorage for existing session
  useEffect(() => {
    const savedToken = localStorage.getItem('dp_token');
    const savedUser = localStorage.getItem('dp_user');
    if (savedToken && savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        if (parsed && typeof parsed === 'object') {
          setToken(savedToken);
          setUser(parsed);
        } else {
          // Corrupted data — clean up
          localStorage.removeItem('dp_token');
          localStorage.removeItem('dp_user');
        }
      } catch {
        // Invalid JSON in localStorage — clean up
        localStorage.removeItem('dp_token');
        localStorage.removeItem('dp_user');
      }
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post<LoginResponse>('/auth/login', { email, password });
    if (!data?.access_token || !data?.user) {
      throw new Error('Invalid login response from server');
    }
    setToken(data.access_token);
    setUser(data.user);
    localStorage.setItem('dp_token', data.access_token);
    localStorage.setItem('dp_user', JSON.stringify(data.user));
  }, []);

  const register = useCallback(async (email: string, password: string, name?: string) => {
    const { data } = await api.post<LoginResponse>('/auth/register', { email, password, name });
    if (!data?.access_token || !data?.user) {
      throw new Error('Invalid registration response from server');
    }
    setToken(data.access_token);
    setUser(data.user);
    localStorage.setItem('dp_token', data.access_token);
    localStorage.setItem('dp_user', JSON.stringify(data.user));
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('dp_token');
    localStorage.removeItem('dp_user');
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
