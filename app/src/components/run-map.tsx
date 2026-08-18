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
 *
 * **러닝 중에는 좌표가 아직 없어도 지도를 띄운다.** 첫 GPS fix까지 몇 초 걸리는데
 * 그동안 정적 이미지를 보여주면 "지도가 안 나온다"로 보인다. 지도를 먼저 띄우고
 * 경로는 점이 쌓이는 대로 그린다.
 *
 * 정적 이미지로 떨어지는 경우는 **경로도 없고 러닝 중도 아닐 때**뿐이다 —
 * 과거 러닝의 결과 이미지처럼 그릴 것이 아예 없는 자리다.
 */
export function RunMap({ live = false, style, interactive = false }: Props) {
  const path = getRoutePath();

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
        followsUserLocation={live}
        initialRegion={path.length > 0 ? regionFor(path) : undefined}
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
        {path.length > 1 ? <Polyline coordinates={[...path]} strokeColor={colors.primary} strokeWidth={5} /> : null}
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
