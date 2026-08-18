import { useEffect, useRef } from 'react';
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
export function RunMap({ live = false, style, interactive = false }: Props) {
  const path = getRoutePath();
  const mapRef = useRef<MapView>(null);
  const framedCount = useRef(0);

  // 첫 fix 전에도 지도를 자기 동네로 옮긴다. 마지막으로 알려진 위치면 충분하다.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;

    void getLastKnownPoint().then((point) => {
      if (cancelled || point === null || framedCount.current > 0) return;
      mapRef.current?.animateToRegion(regionAround(point), 300);
    });

    return () => {
      cancelled = true;
    };
  }, [live]);

  // 좌표가 들어올 때마다 카메라를 다시 잡는다.
  useEffect(() => {
    if (path.length === 0 || path.length === framedCount.current) return;
    framedCount.current = path.length;

    const region = live ? regionAround(path[path.length - 1]) : regionForPath(path);
    mapRef.current?.animateToRegion(region, 500);
  }, [live, path]);

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
});
