import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, compactPressFeedback, typography } from '@/src/theme/tokens';
import { HapticPressable as Pressable } from '@/src/components/haptics';

import AnalysisScreen from './analysis';
import HomeScreen from './index';
import RecordScreen from './record';

const tabs = [
  { path: '/analysis', label: '분석', icon: 'analytics-outline', Screen: AnalysisScreen },
  { path: '/', label: '홈', icon: 'home-outline', Screen: HomeScreen },
  { path: '/record', label: '기록', icon: 'calendar-outline', Screen: RecordScreen },
] as const;

const HOME_INDEX = tabs.findIndex((tab) => tab.path === '/');

export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const pager = useRef<ScrollView>(null);
  const pathnameIndex = tabs.findIndex((tab) => tab.path === pathname);
  // 설정·리포트 등 탭 밖 화면으로 전환할 때 분석 탭이 순간적으로 보이지 않게 한다.
  const initialRouteIndex = pathnameIndex >= 0 ? pathnameIndex : HOME_INDEX;
  const activeIndexRef = useRef(initialRouteIndex);
  const previousPathname = useRef(pathname);
  const [activeIndex, setActiveIndex] = useState(initialRouteIndex);
  const [tabSwipeEnabled, setTabSwipeEnabled] = useState(true);

  useEffect(() => {
    pager.current?.scrollTo({ x: activeIndexRef.current * width, animated: false });
  }, [width]);

  useEffect(() => {
    const previousWasTab = tabs.some((tab) => tab.path === previousPathname.current);
    previousPathname.current = pathname;
    const nextIndex = tabs.findIndex((tab) => tab.path === pathname);
    if (!previousWasTab || nextIndex < 0 || nextIndex === activeIndexRef.current) return;
    activeIndexRef.current = nextIndex;
    setActiveIndex(nextIndex);
    pager.current?.scrollTo({ x: nextIndex * width, animated: true });
  }, [pathname, width]);

  const settleOnPage = (offsetX: number) => {
    const nextIndex = Math.max(0, Math.min(tabs.length - 1, Math.round(offsetX / width)));
    activeIndexRef.current = nextIndex;
    setActiveIndex(nextIndex);
  };

  const moveToPage = (index: number) => {
    activeIndexRef.current = index;
    setActiveIndex(index);
    pager.current?.scrollTo({ x: index * width, animated: true });
  };

  return <View style={styles.root}>
    <ScrollView
      bounces={false}
      contentOffset={{ x: initialRouteIndex * width, y: 0 }}
      decelerationRate="fast"
      directionalLockEnabled
      horizontal
      nestedScrollEnabled
      onMomentumScrollEnd={(event) => settleOnPage(event.nativeEvent.contentOffset.x)}
      onScroll={(event) => {
        const visibleIndex = Math.max(0, Math.min(tabs.length - 1, Math.round(event.nativeEvent.contentOffset.x / width)));
        if (visibleIndex !== activeIndex) setActiveIndex(visibleIndex);
      }}
      pagingEnabled
      ref={pager}
      scrollEventThrottle={16}
      scrollEnabled={tabSwipeEnabled}
      showsHorizontalScrollIndicator={false}
      style={styles.pager}
    >
      {tabs.map(({ path, Screen }) => <View key={path} style={[styles.page, { width }]}>{path === '/analysis' ? <AnalysisScreen active={activeIndex === 0} onCardTouchChange={(active) => setTabSwipeEnabled(!active)} /> : <Screen />}</View>)}
    </ScrollView>
    <View style={[styles.tabBar, { height: 50 + insets.bottom, paddingBottom: insets.bottom }]}>
      {tabs.map((tab, index) => {
        const selected = index === activeIndex;
        const color = selected ? colors.primary : colors.textMuted;
        return <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected }}
          key={tab.path}
          onPress={() => moveToPage(index)}
          style={({ pressed }) => [styles.tabItem, pressed && styles.tabPressed]}
        >
          <View style={styles.tabIcon}><Ionicons color={color} name={tab.icon} size={23} /></View>
          <Text style={[styles.tabLabel, { color }]}>{tab.label}</Text>
        </Pressable>;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  pager: { flex: 1 },
  page: { flex: 1, overflow: 'hidden' },
  tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background },
  tabItem: { flex: 1, height: 50, alignItems: 'center', justifyContent: 'center', gap: 1 },
  tabIcon: { width: 26, height: 25, alignItems: 'center', justifyContent: 'center' },
  tabPressed: compactPressFeedback,
  tabLabel: { ...typography.caption, fontWeight: '700', lineHeight: 16 },
});
