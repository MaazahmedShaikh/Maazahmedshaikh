export type ThemePreset = 'ice' | 'whatsapp';
export type ThemeMode = 'light' | 'dark';

export interface AppTheme {
  preset: ThemePreset;
  mode: ThemeMode;
  isDark: boolean;
  gradientStart: string;
  gradientMid: string;
  gradientEnd: string;
  headerText: string;
  headerSubtext: string;
  bgPrimary: string;
  bgCard: string;
  bgHeader: string;
  bgInputPill: string;
  bgSearchFocus: string;
  searchHeaderBg: string;
  bubbleOutgoing: string;
  bubbleOutgoingText: string;
  bubbleOutgoingMeta: string;
  bubbleIncoming: string;
  bubbleIncomingText: string;
  accentGreen: string;
  onlineGreen: string;
  badgeBg: string;
  badgeText: string;
  tickRead: string;
  tickReadOnBubble: string;
  tickGrayOnBubble: string;
  textPrimary: string;
  textSecondary: string;
  textOnAccent: string;
  divider: string;
  danger: string;
  modalOverlay: string;
  surfaceHighlight: string;
  datePillBg: string;
  datePillText: string;
  quoteOutgoingBg: string;
  quoteIncomingBg: string;
  quoteOutgoingBorder: string;
  quoteIncomingBorder: string;
  quoteOutgoingAuthor: string;
  quoteIncomingAuthor: string;
  burnBadgeOutgoingBg: string;
  burnBadgeOutgoingText: string;
  burnBadgeIncomingBg: string;
  burnBadgeIncomingText: string;
  headerAvatarBg: string;
  headerAvatarBorder: string;
  headerAvatarText: string;
  headerBorderRadius: number;
}

export const THEMES: Record<`${ThemePreset}_${ThemeMode}`, AppTheme> = {
  ice_light: {
    preset: 'ice',
    mode: 'light',
    isDark: false,
    gradientStart: '#3B6FF5',
    gradientMid: '#4B6AF5',
    gradientEnd: '#6C63F6',
    headerText: '#FFFFFF',
    headerSubtext: 'rgba(255, 255, 255, 0.85)',
    bgPrimary: '#F6F8FD',
    bgCard: '#FFFFFF',
    bgHeader: '#4B6AF5',
    bgInputPill: '#F1F4FB',
    bgSearchFocus: '#EEF2FA',
    searchHeaderBg: 'rgba(255, 255, 255, 0.92)',
    bubbleOutgoing: '#4B6AF5',
    bubbleOutgoingText: '#FFFFFF',
    bubbleOutgoingMeta: 'rgba(255, 255, 255, 0.82)',
    bubbleIncoming: '#EEF2FA',
    bubbleIncomingText: '#1E2538',
    accentGreen: '#4B6AF5',
    onlineGreen: '#22C55E',
    badgeBg: '#FF8A34',
    badgeText: '#FFFFFF',
    tickRead: '#4B6AF5',
    tickReadOnBubble: '#FFFFFF',
    tickGrayOnBubble: 'rgba(255, 255, 255, 0.72)',
    textPrimary: '#1E2538',
    textSecondary: '#7E88A0',
    textOnAccent: '#FFFFFF',
    divider: '#E4E9F4',
    danger: '#EF4444',
    modalOverlay: 'rgba(15, 23, 42, 0.45)',
    surfaceHighlight: '#E8EEFA',
    datePillBg: '#E9EEF8',
    datePillText: '#5F6B85',
    quoteOutgoingBg: 'rgba(255, 255, 255, 0.16)',
    quoteIncomingBg: 'rgba(75, 106, 245, 0.08)',
    quoteOutgoingBorder: '#FFFFFF',
    quoteIncomingBorder: '#4B6AF5',
    quoteOutgoingAuthor: '#FFFFFF',
    quoteIncomingAuthor: '#4B6AF5',
    burnBadgeOutgoingBg: 'rgba(255, 255, 255, 0.22)',
    burnBadgeOutgoingText: '#FFFFFF',
    burnBadgeIncomingBg: 'rgba(234, 88, 12, 0.14)',
    burnBadgeIncomingText: '#EA580C',
    headerAvatarBg: 'rgba(255, 255, 255, 0.22)',
    headerAvatarBorder: 'rgba(255, 255, 255, 0.5)',
    headerAvatarText: '#FFFFFF',
    headerBorderRadius: 24,
  },
  ice_dark: {
    preset: 'ice',
    mode: 'dark',
    isDark: true,
    gradientStart: '#3B6FF5',
    gradientMid: '#4B6AF5',
    gradientEnd: '#6C63F6',
    headerText: '#FFFFFF',
    headerSubtext: 'rgba(255, 255, 255, 0.85)',
    bgPrimary: '#0E1322',
    bgCard: '#141B2D',
    bgHeader: '#3B6FF5',
    bgInputPill: '#1C253D',
    bgSearchFocus: '#1B233A',
    searchHeaderBg: 'rgba(20, 27, 45, 0.88)',
    bubbleOutgoing: '#4B6AF5',
    bubbleOutgoingText: '#FFFFFF',
    bubbleOutgoingMeta: 'rgba(255, 255, 255, 0.82)',
    bubbleIncoming: '#1E2740',
    bubbleIncomingText: '#EEF2FF',
    accentGreen: '#5B7CFF',
    onlineGreen: '#22C55E',
    badgeBg: '#FF8A34',
    badgeText: '#FFFFFF',
    tickRead: '#60A5FA',
    tickReadOnBubble: '#FFFFFF',
    tickGrayOnBubble: 'rgba(255, 255, 255, 0.72)',
    textPrimary: '#F1F5FF',
    textSecondary: '#94A3C4',
    textOnAccent: '#FFFFFF',
    divider: '#25314D',
    danger: '#F87171',
    modalOverlay: 'rgba(5, 8, 18, 0.72)',
    surfaceHighlight: '#1E2845',
    datePillBg: '#1C253D',
    datePillText: '#94A3C4',
    quoteOutgoingBg: 'rgba(255, 255, 255, 0.16)',
    quoteIncomingBg: 'rgba(91, 124, 255, 0.14)',
    quoteOutgoingBorder: '#FFFFFF',
    quoteIncomingBorder: '#5B7CFF',
    quoteOutgoingAuthor: '#FFFFFF',
    quoteIncomingAuthor: '#8BA2FF',
    burnBadgeOutgoingBg: 'rgba(255, 255, 255, 0.22)',
    burnBadgeOutgoingText: '#FFFFFF',
    burnBadgeIncomingBg: 'rgba(251, 146, 60, 0.18)',
    burnBadgeIncomingText: '#FB923C',
    headerAvatarBg: 'rgba(255, 255, 255, 0.2)',
    headerAvatarBorder: 'rgba(255, 255, 255, 0.45)',
    headerAvatarText: '#FFFFFF',
    headerBorderRadius: 24,
  },
  whatsapp_light: {
    preset: 'whatsapp',
    mode: 'light',
    isDark: false,
    gradientStart: '#008069',
    gradientMid: '#008069',
    gradientEnd: '#075E54',
    headerText: '#FFFFFF',
    headerSubtext: 'rgba(255, 255, 255, 0.85)',
    bgPrimary: '#EFEAE2',
    bgCard: '#FFFFFF',
    bgHeader: '#008069',
    bgInputPill: '#FFFFFF',
    bgSearchFocus: '#F0F2F5',
    searchHeaderBg: '#F0F2F5',
    bubbleOutgoing: '#D9FDD3',
    bubbleOutgoingText: '#111B21',
    bubbleOutgoingMeta: '#667781',
    bubbleIncoming: '#FFFFFF',
    bubbleIncomingText: '#111B21',
    accentGreen: '#008069',
    onlineGreen: '#25D366',
    badgeBg: '#25D366',
    badgeText: '#FFFFFF',
    tickRead: '#53BDEB',
    tickReadOnBubble: '#53BDEB',
    tickGrayOnBubble: '#667781',
    textPrimary: '#111B21',
    textSecondary: '#667781',
    textOnAccent: '#FFFFFF',
    divider: '#E2E8F0',
    danger: '#DC2626',
    modalOverlay: 'rgba(15, 23, 42, 0.45)',
    surfaceHighlight: '#F0F2F5',
    datePillBg: '#FFFFFF',
    datePillText: '#54656F',
    quoteOutgoingBg: 'rgba(0, 0, 0, 0.05)',
    quoteIncomingBg: '#F0F2F5',
    quoteOutgoingBorder: '#008069',
    quoteIncomingBorder: '#008069',
    quoteOutgoingAuthor: '#008069',
    quoteIncomingAuthor: '#008069',
    burnBadgeOutgoingBg: 'rgba(234, 88, 12, 0.14)',
    burnBadgeOutgoingText: '#EA580C',
    burnBadgeIncomingBg: 'rgba(234, 88, 12, 0.14)',
    burnBadgeIncomingText: '#EA580C',
    headerAvatarBg: 'rgba(255, 255, 255, 0.22)',
    headerAvatarBorder: 'rgba(255, 255, 255, 0.4)',
    headerAvatarText: '#FFFFFF',
    headerBorderRadius: 0,
  },
  whatsapp_dark: {
    preset: 'whatsapp',
    mode: 'dark',
    isDark: true,
    gradientStart: '#1F2C34',
    gradientMid: '#1F2C34',
    gradientEnd: '#1F2C34',
    headerText: '#E9EDEF',
    headerSubtext: '#8696A0',
    bgPrimary: '#0B141A',
    bgCard: '#111B21',
    bgHeader: '#1F2C34',
    bgInputPill: '#2A3942',
    bgSearchFocus: '#202C33',
    searchHeaderBg: '#202C33',
    bubbleOutgoing: '#005C4B',
    bubbleOutgoingText: '#E9EDEF',
    bubbleOutgoingMeta: 'rgba(233, 237, 239, 0.72)',
    bubbleIncoming: '#202C33',
    bubbleIncomingText: '#E9EDEF',
    accentGreen: '#00A884',
    onlineGreen: '#00A884',
    badgeBg: '#00A884',
    badgeText: '#0B141A',
    tickRead: '#53BDEB',
    tickReadOnBubble: '#53BDEB',
    tickGrayOnBubble: '#8696A0',
    textPrimary: '#E9EDEF',
    textSecondary: '#8696A0',
    textOnAccent: '#0B141A',
    divider: '#222E35',
    danger: '#F15C6D',
    modalOverlay: 'rgba(0, 0, 0, 0.75)',
    surfaceHighlight: '#182229',
    datePillBg: 'rgba(31, 44, 52, 0.92)',
    datePillText: '#8696A0',
    quoteOutgoingBg: 'rgba(0, 0, 0, 0.22)',
    quoteIncomingBg: 'rgba(0, 0, 0, 0.22)',
    quoteOutgoingBorder: '#53BDEB',
    quoteIncomingBorder: '#00A884',
    quoteOutgoingAuthor: '#53BDEB',
    quoteIncomingAuthor: '#00A884',
    burnBadgeOutgoingBg: 'rgba(255, 165, 0, 0.2)',
    burnBadgeOutgoingText: '#FFA500',
    burnBadgeIncomingBg: 'rgba(255, 165, 0, 0.2)',
    burnBadgeIncomingText: '#FFA500',
    headerAvatarBg: '#202C33',
    headerAvatarBorder: '#2A3942',
    headerAvatarText: '#00A884',
    headerBorderRadius: 0,
  },
};

export function getTheme(preset: ThemePreset = 'ice', mode: ThemeMode = 'light'): AppTheme {
  return THEMES[`${preset}_${mode}`] ?? THEMES.ice_light;
}

// Backward-compatible default export
export const whatsappTheme = THEMES.ice_light;
