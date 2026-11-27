import React, { createContext, useContext } from 'react';
import { AppTheme, getTheme, THEMES } from './whatsappTheme';

const ThemeContext = createContext<AppTheme>(THEMES.ice_light);

export const ThemeProvider: React.FC<{
  preset?: 'ice' | 'whatsapp';
  mode?: 'light' | 'dark';
  children: React.ReactNode;
}> = ({ preset = 'ice', mode = 'light', children }) => {
  const theme = getTheme(preset, mode);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
};

export function useAppTheme(): AppTheme {
  return useContext(ThemeContext);
}
