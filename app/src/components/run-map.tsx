import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import MapView, { Polyline, type Region } from 'react-native-maps';

import { getLastKnownPoint, getRoutePath, type RoutePoint } from '@/src/store/runController';
import { colors } from '@/src/theme/tokens';

const fallbackImage = require('@/assets/images/run-map.png');

/** 러닝 중 확대 정도(위경도 델타). 0.004면 대략 400m 반경이 보인다. */
const LIVE_DELTA = 0.004;
/** 결과 이미지에서 경로가 화면 안에 들어오도록 남기는 여백 비율. */
const PADDING_RATIO = 0.35;

type Props = {
  /** 러닝 중에는 마지막 좌표를 따라간다. 결과 이미지에서는 경로 전체를 담는다. */
  live?: boolean;
  style?: StyleProp<ViewStyle>;
  /** 결과 이미지처럼 조작이 필요 없는 자리에서는 제스처를 끈다. */
  interactive?: boolean;
  /** 결과 이미지에서는 지도 타일과 카드 장식 없이 경로선만 그린다. */
  routeOnly?: boolean;
};

/**
 * 러닝 경로 지도 (`ENGINE.md` §10).
 *
 * 좌표는 `runController`가 메모리로 들고 있는 값이고 서버로 가지 않는다.
 *
 * **카메라를 명령으로 옮긴다.** `initialRegion`은 마운트 때 한 번만 적용되는데
 * 첫 GPS fix는 그 뒤에 오므로, 그것만 두면 지도가 전 세계 뷰에 머문다.
 * 러닝 중에는 **마지막 좌표를 고정 배율로** 따라가고 — 경로가 길어져도 확대가 풀리지
 * 않는다 — 결과 이미지에서는 경로 전체를 프레임에 맞춘다.
 */
export function RunMap({ live = false, style, interactive = false, routeOnly = false }: Props) {
  const [path, setPath] = useState<readonly RoutePoint[]>(() => getRoutePath());
  const mapRef = useRef<MapView>(null);
  const framedCount = useRef(0);

  // live 모드일 때 2초 간격으로 getRoutePath()를 확인하여 좌표가 늘어났을 때만 state를 갱신한다.
  // (Pedometer tick이 멈추어도 GPS 경로가 지도에 주기적으로 반영되도록 함)
  useEffect(() => {
    setPath(getRoutePath());
    if (!live) return;

    const timer = setInterval(() => {
      const latest = getRoutePath();
      setPath((prev) => (prev.length === latest.length ? prev : latest));
    }, 2000);

    return () => clearInterval(timer);
  }, [live]);

  // 첫 fix 전에도 지도를 자기 동네로 옮긴다. 마지막으로 알려진 위치면 충분하다.
  useEffect(() => {
    if (routeOnly) return;
    if (!live) return;
    let cancelled = false;

    void getLastKnownPoint().then((point) => {
      if (cancelled || point === null || framedCount.current > 0) return;
      mapRef.current?.animateToRegion(regionAround(point), 300);
    });

    return () => {
      cancelled = true;
    };
  }, [live, routeOnly]);

  // 좌표가 들어올 때마다 카메라를 다시 잡는다.
  useEffect(() => {
    if (routeOnly) return;
    if (path.length === 0 || path.length === framedCount.current) return;
    framedCount.current = path.length;

    const region = live ? regionAround(path[path.length - 1]) : regionForPath(path);
    mapRef.current?.animateToRegion(region, 500);
  }, [live, path, routeOnly]);

  if (routeOnly) {
    return <RouteOnly path={path} style={style} />;
  }

  if (path.length === 0 && !live) {
    return (
      <View style={[styles.fill, style]}>
        <Image resizeMode="cover" source={fallbackImage} style={StyleSheet.absoluteFill} />
      </View>
    );
  }

  return (
    <View style={[styles.fill, style]}>
      <MapView
        pitchEnabled={false}
        pointerEvents={interactive ? 'auto' : 'none'}
        ref={mapRef}
        rotateEnabled={false}
        scrollEnabled={interactive}
        showsCompass={false}
        showsUserLocation={live}
        style={StyleSheet.absoluteFill}
        toolbarEnabled={false}
        zoomEnabled={interactive}
      >
        {path.length > 1 ? (
          <Polyline coordinates={[...path]} strokeColor={colors.primary} strokeWidth={5} />
        ) : null}
      </MapView>
    </View>
  );
}

function RouteOnly({ path, style }: { path: readonly RoutePoint[]; style?: StyleProp<ViewStyle> }) {
  if (path.length < 2) return <View pointerEvents="none" style={[styles.routeOnlyFill, style]} />;

  const points = normalizePath(path);
  return (
    <View pointerEvents="none" style={[styles.routeOnlyFill, style]}>
      {points.slice(1).map((point, index) => {
        const previous = points[index];
        const dx = point.x - previous.x;
        const dy = point.y - previous.y;
        const length = Math.sqrt((dx * dx) + (dy * dy));
        const angle = Math.atan2(dy, dx);
        return <View key={`${index}-${point.x}-${point.y}`} style={[styles.routeSegment, {
          left: (previous.x + point.x) / 2 - length / 2,
          top: (previous.y + point.y) / 2 - 1.5,
          width: length,
          transform: [{ rotate: `${angle}rad` }],
        }]} />;
      })}
    </View>
  );
}

function normalizePath(path: readonly RoutePoint[]) {
  const minLat = Math.min(...path.map((point) => point.latitude));
  const maxLat = Math.max(...path.map((point) => point.latitude));
  const minLon = Math.min(...path.map((point) => point.longitude));
  const maxLon = Math.max(...path.map((point) => point.longitude));
  const latRange = Math.max(maxLat - minLat, 0.00001);
  const lonRange = Math.max(maxLon - minLon, 0.00001);
  // The route view is sized by its parent, so coordinates use a 0–100 box and
  // percentage positioning is not available for native Views. A fixed design
  // box keeps the line stable inside the 104×116 result-image slot.
  const width = 104;
  const height = 116;
  const padding = 10;
  return path.map((point) => ({
    x: padding + ((point.longitude - minLon) / lonRange) * (width - padding * 2),
    y: padding + ((maxLat - point.latitude) / latRange) * (height - padding * 2),
  }));
}

/** 한 점을 고정 배율로 가운데 둔다. */
function regionAround(point: RoutePoint): Region {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    latitudeDelta: LIVE_DELTA,
    longitudeDelta: LIVE_DELTA,
  };
}

/** 경로 전체가 보이도록 중심과 배율을 잡는다. */
function regionForPath(path: readonly RoutePoint[]): Region {
  const latitudes = path.map((point) => point.latitude);
  const longitudes = path.map((point) => point.longitude);

  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * (1 + PADDING_RATIO), LIVE_DELTA),
    longitudeDelta: Math.max((maxLon - minLon) * (1 + PADDING_RATIO), LIVE_DELTA),
  };
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', left: 0, right: 0, width: '100%', bottom: 0 },
  routeOnlyFill: { position: 'absolute' },
  routeSegment: {
    position: 'absolute',
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.primary,
    shadowColor: colors.black,
    shadowOpacity: 0.8,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});
