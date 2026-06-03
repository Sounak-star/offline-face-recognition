import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Tabs } from 'expo-router';
import { useColorScheme, StyleSheet } from 'react-native';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#0A84FF',
          tabBarInactiveTintColor: isDark ? '#8E8E93' : '#8E8E93',
          tabBarStyle: {
            backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF',
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: isDark ? '#38383A' : '#E5E5E5',
            height: 60,
            paddingBottom: 8,
            paddingTop: 4,
          },
          tabBarLabelStyle: {
            fontSize: 12,
            fontWeight: '600',
          },
        }}
      >
        <Tabs.Screen name="enroll"   options={{ title: 'Enroll' }} />
        <Tabs.Screen name="verify"   options={{ title: 'Verify' }} />
        <Tabs.Screen name="history"  options={{ title: 'History' }} />
        <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
      </Tabs>
    </ThemeProvider>
  );
}
