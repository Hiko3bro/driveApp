import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import MapView, { PROVIDER_GOOGLE, Marker, Polyline } from 'react-native-maps';

import { Colors, Radius } from '@/constants/design-tokens';
import {
  DEMO_MAP_REGION,
  isValidCoordinates,
  isValidMapRegion,
} from '@/services/location/coordinates';
import type { Coordinates, MapRegion } from '@/types/location';

/**
 * 地図の描画エンジンだけを分離する(Google Places/Google Routesの検索・ルート計算は
 * 一切変更しない、地図タイルの見た目だけの話)。providerを明示しない場合の
 * react-native-mapsの既定挙動どおり、iOSはApple Maps(MapKit)・AndroidはGoogle Mapsに
 * なる。ここでは意図を明文化するため、Androidにだけ明示的にPROVIDER_GOOGLEを指定する
 * (iOSはundefinedのままにして、ライブラリの既定=Apple Mapsを使う)。
 */
const MAP_PROVIDER = Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined;

export interface MapMarkerSpec {
  id: string;
  coordinate: Coordinates;
  title: string;
  description?: string;
  color?: string;
  onPress?: () => void;
  /** 重なったMarker同士で前面に出したいものを指定する(選択中Marker用など)。 */
  zIndex?: number;
}

export interface DriveMapViewHandle {
  animateToRegion: (region: MapRegion, durationMs?: number) => void;
  getCenter: () => Promise<Coordinates | null>;
}

export interface DriveMapViewProps {
  initialRegion: MapRegion;
  /**
   * 地図の中心を外部から継続的に制御したい場合のみ指定する(場所指定モードの中央ピン用途など)。
   * ルート比較画面のようにプログラムからカメラを動かす場合は、region ではなく
   * ref経由の animateToRegion を使うこと(controlled region と併用すると
   * ネイティブ側のカメラ制御が競合し、クラッシュの原因になり得るため)。
   */
  region?: MapRegion;
  markers?: MapMarkerSpec[];
  polyline?: Coordinates[];
  /** ルート切り替え時にPolyline/Markerを確実に作り直させるためのキー。 */
  contentKey?: string;
  polylineColor?: string;
  onRegionChangeComplete?: (region: MapRegion) => void;
  onMapReady?: () => void;
  /**
   * 地図の背景(Marker以外)をタップした時に呼ばれる。react-native-mapsは、
   * 自前のonPressを持つMarker上のタップにはMapViewのonPressを発火させないため、
   * これを「Marker以外をタップ=選択解除」の実装に使う。
   */
  onPress?: () => void;
  /** 地図中央に固定ピンを重ねて表示する(場所指定モード用)。 */
  showCenterPin?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const DriveMapView = forwardRef<DriveMapViewHandle, DriveMapViewProps>(
  function DriveMapView(
    {
      initialRegion,
      region,
      markers = [],
      polyline,
      contentKey,
      polylineColor = Colors.accentBlue,
      onRegionChangeComplete,
      onMapReady,
      onPress,
      showCenterPin = false,
      style,
    },
    ref
  ) {
    const mapRef = useRef<MapView>(null);

    useImperativeHandle(
      ref,
      () => ({
        animateToRegion: (nextRegion, durationMs = 450) => {
          if (isValidMapRegion(nextRegion)) {
            mapRef.current?.animateToRegion(nextRegion, durationMs);
          }
        },
        getCenter: async () => {
          const map = mapRef.current;
          if (!map) {
            return null;
          }

          const camera = await map.getCamera();
          return camera.center
            ? { latitude: camera.center.latitude, longitude: camera.center.longitude }
            : null;
        },
      }),
      []
    );

    const safeInitialRegion = isValidMapRegion(initialRegion) ? initialRegion : DEMO_MAP_REGION;
    const safeRegion = region && isValidMapRegion(region) ? region : undefined;
    const safeMarkers = markers.filter((marker) => isValidCoordinates(marker.coordinate));
    const safePolyline = polyline?.every(isValidCoordinates) ? polyline : undefined;

    return (
      <View style={[styles.container, style]}>
        <MapView
          ref={mapRef}
          provider={MAP_PROVIDER}
          style={StyleSheet.absoluteFill}
          initialRegion={safeInitialRegion}
          region={safeRegion}
          onRegionChangeComplete={onRegionChangeComplete}
          onMapReady={onMapReady}
          onPress={onPress}
          showsCompass={false}>
          {safeMarkers.map((marker) => (
            <Marker
              key={`${contentKey ?? 'marker'}-${marker.id}`}
              coordinate={marker.coordinate}
              title={marker.title}
              description={marker.description}
              pinColor={marker.color}
              zIndex={marker.zIndex}
              onPress={marker.onPress}
            />
          ))}
          {safePolyline && safePolyline.length > 1 && (
            <Polyline
              key={contentKey ?? 'polyline'}
              coordinates={safePolyline}
              strokeColor={polylineColor}
              strokeWidth={4}
            />
          )}
        </MapView>
        {showCenterPin && (
          <View pointerEvents="none" style={styles.centerPin}>
            <View style={styles.centerPinDot} />
          </View>
        )}
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceElevated,
  },
  centerPin: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -12,
    marginTop: -24,
    alignItems: 'center',
  },
  centerPinDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.accentRed,
    borderWidth: 3,
    borderColor: Colors.textPrimary,
  },
});
