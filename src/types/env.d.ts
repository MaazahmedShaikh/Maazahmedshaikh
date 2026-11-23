declare module 'react-native-safe-area-context' {
  import * as React from 'react';
  export const SafeAreaProvider: React.FC<any>;
  export const SafeAreaView: React.FC<any>;
  export const useSafeAreaInsets: () => {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
}

