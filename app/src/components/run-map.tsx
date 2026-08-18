import MapView, { Polyline } from 'react-native-maps';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { getRoutePath, type RoutePoint } from '@/src/store/runController';
import { colors } from '@/src/theme/tokens';

const fallbackImage = require('@/assets/images/run-map.png');

/** 경로가 화면 안에 들어오도록 남기는 여백 비율. */
const PADDING_RATIO = 0.35;
/** 점이 하나뿐일 때 쓰는 기본 확대 정도(위경도 델타). */
const SINGLE_POINT_DELTA = 0.003;

type Props = {
  /** 러닝 중에는 현재 위치를 따라간다. 결과 이미지에서는 고정한다. */
  live?: boolean;
  style?: StyleProp<ViewStyle>;
  /** 결과 이미지처럼 조작이 필요 없는 자리에서는 제스처를 끈다. */
  interactive?: boolean;
};

/**
 * 러닝 경로 지도 (`ENGINE.md` §10).
 *
 * 좌표는 `runController`가 메모리로 들고 있는 값이고 서버로 가지 않는다.
 * GPS를 못 받았거나 실내라 경로가 없으면 **기존 정적 이미지로 떨어진다** —
 * 빈 회색 지도가 뜨는 것보다 낫고, 시연 중 GPS가 안 잡혀도 화면이 비지 않는다.
 */
export function RunMap({ live = false, style, interactive = false }: Props) {
  const path = getRoutePath();

  if (path.length === 0) {
    return (
      <View style={[styles.fill, style]}>
        <Image resizeMode="cover" source={fallbackImage} style={StyleSheet.absoluteFill} />
      </View>
    );
  }

  return (
    <View style={[styles.fill, style]}>
      <MapView
        initialRegion={regionFor(path)}
        pitchEnabled={false}
        pointerEvents={interactive ? 'auto' : 'none'}
        rotateEnabled={false}
        scrollEnabled={interactive}
        showsCompass={false}
        showsUserLocation={live}
        style={StyleSheet.absoluteFill}
        toolbarEnabled={false}
        zoomEnabled={interactive}
      >
        <Polyline coordinates={[...path]} strokeColor={colors.primary} strokeWidth={5} />
      </MapView>
    </View>
  );
}

/** 경로 전체가 보이도록 중심과 배율을 잡는다. */
function regionFor(path: readonly RoutePoint[]) {
  const latitudes = path.map((point) => point.latitude);
  const longitudes = path.map((point) => point.longitude);

  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * (1 + PADDING_RATIO), SINGLE_POINT_DELTA),
    longitudeDelta: Math.max((maxLon - minLon) * (1 + PADDING_RATIO), SINGLE_POINT_DELTA),
  };
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', left: 0, right: 0, width: '100%', bottom: 0 },
});
