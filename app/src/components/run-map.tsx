import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import MapView, { Polyline, type Region } from 'react-native-maps';
import Svg, { Path } from 'react-native-svg';

import { getLastKnownPoint, getRoutePath, type RoutePoint } from '@/src/store/runController';
import { colors } from '@/src/theme/tokens';

const fallbackImage = require('@/assets/images/run-map.png');

/** 러닝 중 확대 정도(위경도 델타). 0.004면 대략 400m 반경이 보인다. */
const LIVE_DELTA = 0.004;
/** 결과 이미지에서 경로가 화면 안에 들어오도록 남기는 여백 비율. */
const PADDING_RATIO = 0.35;
/** 결과 이미지의 경로 자리. 부모가 크기를 주지 않으므로 여기 값에 맞춰 그린다. */
const ROUTE_BOX = { width: 104, height: 116, padding: 10 } as const;
/** 곡선에 쓸 최대 점 개수. 30분 러닝이면 원본이 수백 개다. */
const ROUTE_MAX_POINTS = 120;

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

/**
 * 결과 이미지의 경로선.
 *
 * 회전시킨 사각형을 이어 붙이면 꺾이는 자리마다 틈과 각이 생겨 코스가 끊겨 보인다.
 * 한 붓으로 그린 곡선 하나로 그린다 — 이음새가 없고 GPS 떨림도 눈에 덜 띈다.
 */
function RouteOnly({ path, style }: { path: readonly RoutePoint[]; style?: StyleProp<ViewStyle> }) {
  if (path.length < 2) return <View pointerEvents="none" style={[styles.routeOnlyFill, style]} />;

  const points = smooth(decimate(normalizePath(path)));
  return (
    <View pointerEvents="none" style={[styles.routeOnlyFill, style]}>
      <Svg width={ROUTE_BOX.width} height={ROUTE_BOX.height}>
        <Path
          d={toCurve(points)}
          fill="none"
          stroke={colors.primary}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

type Point = { x: number; y: number };

/**
 * 점이 많으면 곡선이 무거워지고, GPS 떨림이 그대로 남는다.
 * 고르게 솎아 모양은 유지하면서 개수를 줄인다. 시작과 끝은 반드시 남긴다.
 */
function decimate(points: Point[]): Point[] {
  if (points.length <= ROUTE_MAX_POINTS) return points;
  const step = (points.length - 1) / (ROUTE_MAX_POINTS - 1);
  return Array.from({ length: ROUTE_MAX_POINTS }, (_, index) => points[Math.round(index * step)]);
}

/** 이웃 세 점의 평균으로 떨림을 눌러 준다. 양 끝은 그대로 둔다. */
function smooth(points: Point[]): Point[] {
  if (points.length < 3) return points;
  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return point;
    const before = points[index - 1];
    const after = points[index + 1];
    return {
      x: (before.x + point.x + after.x) / 3,
      y: (before.y + point.y + after.y) / 3,
    };
  });
}

/**
 * Catmull-Rom을 3차 베지어로 옮겨 한 붓 곡선을 만든다.
 * 점을 그대로 지나가면서도 꺾이는 자리가 둥글게 이어진다.
 */
function toCurve(points: Point[]): string {
  if (points.length < 2) return '';
  let d = `M ${round(points[0].x)} ${round(points[0].y)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const after = points[index + 2] ?? next;
    const c1x = current.x + (next.x - previous.x) / 6;
    const c1y = current.y + (next.y - previous.y) / 6;
    const c2x = next.x - (after.x - current.x) / 6;
    const c2y = next.y - (after.y - current.y) / 6;
    d += ` C ${round(c1x)} ${round(c1y)}, ${round(c2x)} ${round(c2y)}, ${round(next.x)} ${round(next.y)}`;
  }
  return d;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizePath(path: readonly RoutePoint[]): Point[] {
  const minLat = Math.min(...path.map((point) => point.latitude));
  const maxLat = Math.max(...path.map((point) => point.latitude));
  const minLon = Math.min(...path.map((point) => point.longitude));
  const maxLon = Math.max(...path.map((point) => point.longitude));
  const latRange = Math.max(maxLat - minLat, 0.00001);
  const lonRange = Math.max(maxLon - minLon, 0.00001);
  const { width, height, padding } = ROUTE_BOX;
  // 위경도는 종횡비가 다르므로 더 넓은 쪽에 맞춰 같은 배율로 줄인다.
  // 축마다 따로 늘리면 코스 모양이 찌그러진다.
  const scale = Math.min((width - padding * 2) / lonRange, (height - padding * 2) / latRange);
  const offsetX = (width - lonRange * scale) / 2;
  const offsetY = (height - latRange * scale) / 2;
  return path.map((point) => ({
    x: offsetX + (point.longitude - minLon) * scale,
    y: offsetY + (maxLat - point.latitude) * scale,
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
});
