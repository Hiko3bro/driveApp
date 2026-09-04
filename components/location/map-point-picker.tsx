import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DriveMapView, type DriveMapViewHandle } from '@/components/map/drive-map-view';
import { PrimaryButton } from '@/components/ui/primary-button';
import { isValidCoordinates } from '@/services/location/coordinates';
import type { Coordinates, MapRegion } from '@/types/location';

interface MapPointPickerProps {
  title: string;
  instruction: string;
  initialRegion: MapRegion;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (coordinates: Coordinates) => void;
}

/**
 * 中央固定ピン方式の地図ピッカー。app/departure.tsxの地図選択と同じ考え方
 * (地図を動かして中央のピンを合わせ、確定時にネイティブカメラの中心を取得する)を
 * 独立したコンポーネントとして実装したもの。「最後はどこにする?」「経由したい場所」の
 * 両方から使う。departure.tsx自体は変更しない。
 */
export function MapPointPicker({
  title,
  instruction,
  initialRegion,
  confirmLabel = 'この場所に決定',
  onCancel,
  onConfirm,
}: MapPointPickerProps) {
  const mapRef = useRef<DriveMapViewHandle>(null);
  const isMountedRef = useRef(true);
  const sessionIdRef = useRef(0);
  const confirmationInFlightRef = useRef(false);

  const [mapReady, setMapReady] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [pickedCenter, setPickedCenter] = useState<Coordinates>(initialRegion);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleRegionChangeComplete = useCallback((region: MapRegion) => {
    const center: Coordinates = { latitude: region.latitude, longitude: region.longitude };
    if (isValidCoordinates(center)) {
      setPickedCenter(center);
    }
  }, []);

  const handleMapReady = useCallback(() => {
    if (isMountedRef.current) {
      setMapReady(true);
    }
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!mapReady || confirmationInFlightRef.current) {
      return;
    }

    const sessionId = sessionIdRef.current;
    const requestIsActive = () => isMountedRef.current && sessionIdRef.current === sessionId;

    confirmationInFlightRef.current = true;
    setResolving(true);
    setError(null);

    try {
      const center = await mapRef.current?.getCenter();
      if (!requestIsActive()) {
        return;
      }
      if (!isValidCoordinates(center)) {
        setError('場所を確認できませんでした。地図の読み込みを待って、もう一度お試しください。');
        return;
      }
      onConfirm({ latitude: center.latitude, longitude: center.longitude });
    } catch {
      if (requestIsActive()) {
        setError('場所を確認できませんでした。地図を動かして、もう一度お試しください。');
      }
    } finally {
      confirmationInFlightRef.current = false;
      if (requestIsActive()) {
        setResolving(false);
      }
    }
  }, [mapReady, onConfirm]);

  const handleCancel = useCallback(() => {
    if (confirmationInFlightRef.current) {
      return;
    }
    sessionIdRef.current += 1;
    onCancel();
  }, [onCancel]);

  const confirmDisabled = !mapReady || !isValidCoordinates(pickedCenter) || resolving;
  const confirmButtonLabel = !mapReady
    ? '地図を準備しています…'
    : resolving
      ? '場所を確認しています…'
      : confirmLabel;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.instruction}>{instruction}</Text>
      </View>
      <DriveMapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        showCenterPin
        onRegionChangeComplete={handleRegionChangeComplete}
        onMapReady={handleMapReady}
      />
      {error && <Text style={styles.errorText}>{error}</Text>}
      <View style={styles.footer}>
        <PrimaryButton label={confirmButtonLabel} onPress={handleConfirm} disabled={confirmDisabled} />
        <PrimaryButton label="戻る" variant="secondary" onPress={handleCancel} disabled={resolving} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    padding: 20,
    paddingBottom: 12,
    gap: 6,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#11181C',
  },
  instruction: {
    fontSize: 14,
    lineHeight: 21,
    color: '#5b6770',
  },
  map: {
    flex: 1,
    marginHorizontal: 20,
  },
  errorText: {
    color: '#c0392b',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  footer: {
    padding: 20,
    gap: 12,
  },
});
