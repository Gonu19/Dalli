import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { colors, typography } from '@/src/theme/tokens';

export default function TabsLayout() {
  return (
    <Tabs
      initialRouteName="index"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: typography.caption,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}>
      <Tabs.Screen
        name="analysis"
        options={{
          title: '분석',
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="analytics-outline" size={size} />,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: '홈',
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="home-outline" size={size} />,
        }}
      />
      <Tabs.Screen
        name="record"
        options={{
          title: '기록',
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="calendar-outline" size={size} />,
        }}
      />
    </Tabs>
  );
}
