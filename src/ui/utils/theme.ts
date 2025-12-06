/**
 * Theme system for terminal UI
 */
import React from 'react';

export interface Theme {
  bashBorder: string;
  accent: string;
  noting: string;
  permission: string;
  secondaryBorder: string;
  text: string;
  secondaryText: string;
  suggestion: string;
  success: string;
  error: string;
  warning: string;
  primary: string;
  secondary: string;
  tool: string;
  dim: string;
  diff: {
    added: string;
    removed: string;
    addedDimmed: string;
    removedDimmed: string;
  };
}

export const darkTheme: Theme = {
  bashBorder: '#FF6E57',
  accent: '#FFC233',
  noting: '#222222',
  permission: '#b1b9f9',
  secondaryBorder: '#888',
  text: '#fff',
  secondaryText: '#999',
  suggestion: '#b1b9f9',
  success: '#4eba65',
  error: '#ff6b80',
  warning: '#ffc107',
  primary: '#fff',
  secondary: '#999',
  tool: '#60a5fa',
  dim: '#666',
  diff: {
    added: '#225c2b',
    removed: '#7a2936',
    addedDimmed: '#47584a',
    removedDimmed: '#69484d',
  },
};

export const lightTheme: Theme = {
  bashBorder: '#FF6E57',
  accent: '#FFC233',
  noting: '#222222',
  permission: '#e9c61aff',
  secondaryBorder: '#999',
  text: '#000',
  secondaryText: '#666',
  suggestion: '#32e98aff',
  success: '#2c7a39',
  error: '#ab2b3f',
  warning: '#966c1e',
  primary: '#000',
  secondary: '#666',
  tool: '#2563eb',
  dim: '#999',
  diff: {
    added: '#69db7c',
    removed: '#ffa8b4',
    addedDimmed: '#c7e1cb',
    removedDimmed: '#fdd2d8',
  },
};

// Theme context
const ThemeContext = React.createContext<Theme>(darkTheme);

export const ThemeProvider = ThemeContext.Provider;

export function useTheme(): Theme {
  return React.useContext(ThemeContext);
}

// Simple accessor for non-React code
let currentTheme: Theme = darkTheme;

export function setTheme(theme: 'dark' | 'light'): void {
  currentTheme = theme === 'light' ? lightTheme : darkTheme;
}

export function getTheme(): Theme {
  return currentTheme;
}

// Platform-specific circle character
export const BLACK_CIRCLE = process.platform === 'darwin' ? '⏺' : '●';
