import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Radius, Spacing, Typography } from '@/constants/design-tokens';
import type { Coordinates, MapRegion } from '@/types/location';

export interface MapMarkerSpec {
  id: string;
  coordinate: Coordinates;
  title: string;
  description?: string;
  color?: string;
  onPress?: () => void;
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
 * プレースホルダーを表示する。地図・ルート比較の実確認はiOSで行う。
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
        <Text style={styles.title} accessibilityRole="header">地図はモバイル端末でご確認ください</Text>
        <Text style={styles.description}>
          react-native-mapsはWeb未対応のため、Web版では地図を表示できません。正式な検証対象であるiOS実機でご確認ください。
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
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  title: {
    fontWeight: '600',
    fontSize: Typography.cardTitle.fontSize,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  description: {
    fontSize: Typography.secondary.fontSize,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  markerList: {
    alignSelf: 'stretch',
  },
  markerItem: {
    fontSize: Typography.secondary.fontSize,
    color: Colors.textSecondary,
  },
});
