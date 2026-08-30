import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { Coordinates, MapRegion } from '@/types/location';

export interface MapMarkerSpec {
  id: string;
  coordinate: Coordinates;
  title: string;
  color?: string;
}

export interface DriveMapViewHandle {
  animateToRegion: (region: MapRegion, durationMs?: number) => void;
  getCenter: () => Promise<Coordinates | null>;
}

export interface DriveMapViewProps {
  initialRegion: MapRegion;
  region?: MapRegion;
  markers?: MapMarkerSpec[];
  polyline?: Coordinates[];
  contentKey?: string;
  polylineColor?: string;
  onRegionChangeComplete?: (region: MapRegion) => void;
  onMapReady?: () => void;
  showCenterPin?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * react-native-mapsはWeb未対応のため、Web版では地図の代わりに
 * プレースホルダーを表示する。地図・ルート比較の実確認はiOS/Androidで行う。
 */
export const DriveMapView = forwardRef<DriveMapViewHandle, DriveMapViewProps>(
  function DriveMapView({ markers = [], style, onMapReady }, ref) {
    useImperativeHandle(
      ref,
      () => ({
        animateToRegion: () => {},
        // Web版にはネイティブカメラがないため、呼び出し側に取得不能を明示する。
        getCenter: async () => null,
      }),
      []
    );

    useEffect(() => {
      onMapReady?.();
    }, [onMapReady]);

    return (
      <View style={[styles.container, style]}>
        <Text style={styles.title}>地図はモバイル端末でご確認ください</Text>
        <Text style={styles.description}>
          react-native-mapsはWeb未対応のため、Web版では地図を表示できません。iOS/Androidの実機またはシミュレータでご確認ください。
        </Text>
        {markers.length > 0 && (
          <View style={styles.markerList}>
            {markers.map((marker) => (
              <Text key={marker.id} style={styles.markerItem}>
                ・{marker.title}
              </Text>
            ))}
          </View>
        )}
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: '#eef2f3',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontWeight: '600',
    fontSize: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    fontSize: 13,
    color: '#556',
    textAlign: 'center',
    marginBottom: 12,
  },
  markerList: {
    alignSelf: 'stretch',
  },
  markerItem: {
    fontSize: 13,
    color: '#334',
  },
});
