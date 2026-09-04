import { useFocusEffect, usePreventRemove } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DriveMapView, type DriveMapViewHandle } from '@/components/map/drive-map-view';
import { PrimaryButton } from '@/components/ui/primary-button';
import { SelectionCard } from '@/components/ui/selection-card';
import { WizardProgressHeader } from '@/components/ui/wizard-progress-header';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { DEMO_MAP_REGION, isValidCoordinates } from '@/services/location/coordinates';
import { requestCurrentLocation } from '@/services/location/current-location';
import { getHomeLocation, saveHomeLocation } from '@/services/location/home-location-store';
import type { Coordinates, MapRegion } from '@/types/location';

function regionFromCoordinates(coordinates: Coordinates): MapRegion {
  return { ...coordinates, latitudeDelta: 0.03, longitudeDelta: 0.03 };
}

type Mode = 'menu' | 'locating' | 'location-denied' | 'home-register' | 'custom-pick';

export default function DepartureScreen() {
  const { departure, setDeparture } = useDriveFlow();

  const [mode, setMode] = useState<Mode>('menu');
  const [homeChecked, setHomeChecked] = useState(false);
  const [homeLocation, setHomeLocation] = useState<Coordinates | null>(null);
  const [lastKnownLocation, setLastKnownLocation] = useState<Coordinates | null>(null);

  // pickerRegion: initialRegionの仕様に合わせ、地図を開いた瞬間だけ決める初期位置。
  // ユーザー操作後のカメラはcontrolled regionにせず、ネイティブ地図へ任せる。
  const [pickerRegion, setPickerRegion] = useState<MapRegion>(DEMO_MAP_REGION);
  // pickedCenterはonRegionChangeCompleteで得た補助表示用の値。
  // 確定時の正は必ずネイティブMapViewのgetCamera()から取得する。
  const [pickedCenter, setPickedCenter] = useState<Coordinates>(DEMO_MAP_REGION);

  const [mapReady, setMapReady] = useState(false);
  const [resolvingCenter, setResolvingCenter] = useState(false);
  const [savingHome, setSavingHome] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);

  const handlePreventPickerRemoval = useCallback(() => {
    Alert.alert(
      '処理中です',
      savingHome
        ? '自宅を登録しています。完了するまでこの画面でお待ちください。'
        : '地図の中心を確認しています。完了するまでこの画面でお待ちください。'
    );
  }, [savingHome]);

  // ヘッダー戻る、スワイプ、Androidの戻る、pop/resetなど、現在ルートを
  // 削除するすべてのナビゲーション操作を短時間の確定処理中だけ抑止する。
  usePreventRemove(resolvingCenter || savingHome, handlePreventPickerRemoval);

  // Stackナビゲーションでは戻り先の画面が破棄されずに残るため、画面遷移後に
  // 非同期処理が完了してもstate更新やnavigateを行ってよいかをこの参照で判定する。
  const isMountedRef = useRef(true);
  const isFocusedRef = useRef(false);
  const mapRef = useRef<DriveMapViewHandle>(null);
  const locationRequestIdRef = useRef(0);
  const pickerSessionIdRef = useRef(0);
  const pickerConfirmationInFlightRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      return () => {
        isFocusedRef.current = false;
        locationRequestIdRef.current += 1;
        pickerSessionIdRef.current += 1;
        pickerConfirmationInFlightRef.current = false;
        setMapReady(false);
        setResolvingCenter(false);
        setSavingHome(false);
        setMode((currentMode) =>
          currentMode === 'locating' || currentMode === 'home-register' || currentMode === 'custom-pick'
            ? 'menu'
            : currentMode
        );
      };
    }, [])
  );

  useEffect(() => {
    getHomeLocation().then((coords) => {
      if (isMountedRef.current) {
        setHomeLocation(coords);
        setHomeChecked(true);
      }
    });
  }, []);

  const openPicker = useCallback((mode_: 'home-register' | 'custom-pick', center: Coordinates) => {
    const safeCenter = isValidCoordinates(center) ? center : DEMO_MAP_REGION;
    const region = regionFromCoordinates(safeCenter);
    pickerSessionIdRef.current += 1;
    pickerConfirmationInFlightRef.current = false;
    setPickerRegion(region);
    setPickedCenter(safeCenter);
    setMapReady(false);
    setResolvingCenter(false);
    setSavingHome(false);
    setPickerError(null);
    setMode(mode_);
  }, []);

  const handleUseCurrentLocation = useCallback(async () => {
    const requestId = locationRequestIdRef.current + 1;
    locationRequestIdRef.current = requestId;
    setMode('locating');
    // 成功/拒否/例外のどの経路をたどっても、finallyで必ずloading状態(locating)を
    // 終了させる。ここを抜けた時点でmodeが'locating'のまま残ることはない。
    let granted: { coordinates: Coordinates } | null = null;
    try {
      const result = await requestCurrentLocation();
      if (result.status === 'granted') {
        granted = { coordinates: result.coordinates };
      }
    } finally {
      const requestIsActive =
        isMountedRef.current &&
        isFocusedRef.current &&
        locationRequestIdRef.current === requestId;
      if (!requestIsActive) {
        return;
      }

      setMode(granted ? 'menu' : 'location-denied');
      if (granted && isValidCoordinates(granted.coordinates)) {
        setLastKnownLocation(granted.coordinates);
        setDeparture({ source: 'current', coordinates: granted.coordinates, label: '現在地' });
        router.push('/conditions');
      }
    }
  }, [setDeparture]);

  const handleUseHome = useCallback(() => {
    if (homeLocation) {
      setDeparture({ source: 'home', coordinates: homeLocation, label: '自宅' });
      router.push('/conditions');
      return;
    }

    openPicker('home-register', lastKnownLocation ?? DEMO_MAP_REGION);
  }, [homeLocation, lastKnownLocation, setDeparture, openPicker]);

  const handleStartHomeChange = useCallback(() => {
    if (!homeLocation) {
      return;
    }
    // 変更後の座標はhandleSaveHomeで確定するまでSecureStoreへ書き込まない。
    // 「戻る」で抜けた場合はここでのpickedCenterの変更が破棄されるだけで、
    // 元の自宅(homeLocation)はそのまま保持される。
    openPicker('home-register', homeLocation);
  }, [homeLocation, openPicker]);

  const handleStartCustomPick = useCallback(() => {
    // 1. すでに指定した場所が選択済みなら、その地点を初期中心にする。
    if (departure?.source === 'custom' && isValidCoordinates(departure.coordinates)) {
      openPicker('custom-pick', departure.coordinates);
      return;
    }
    // 2. 指定地点はないが、現在地を取得済み(このセッション内でキャッシュ済み)ならそれを使う。
    if (lastKnownLocation) {
      openPicker('custom-pick', lastKnownLocation);
      return;
    }

    // 3. どちらもない場合のみ、初期中心を決めるために現在地取得を1回だけ試みる。
    // 取得できてもできなくても指定場所選択自体は継続できるよう、失敗時は
    // location-deniedへは遷移させず、安全なデフォルトregionへフォールバックする。
    const requestId = locationRequestIdRef.current + 1;
    locationRequestIdRef.current = requestId;
    setMode('locating');

    void requestCurrentLocation().then((result) => {
      const requestIsActive =
        isMountedRef.current && isFocusedRef.current && locationRequestIdRef.current === requestId;
      if (!requestIsActive) {
        return;
      }

      if (result.status === 'granted' && isValidCoordinates(result.coordinates)) {
        setLastKnownLocation(result.coordinates);
        openPicker('custom-pick', result.coordinates);
      } else {
        openPicker('custom-pick', DEMO_MAP_REGION);
      }
    });
  }, [departure, lastKnownLocation, openPicker]);

  const handleCancelPicker = useCallback(() => {
    if (pickerConfirmationInFlightRef.current) {
      return;
    }
    pickerSessionIdRef.current += 1;
    setMapReady(false);
    setPickerError(null);
    setMode('menu');
  }, []);

  const handleRegionChangeComplete = useCallback((region: MapRegion) => {
    const center: Coordinates = { latitude: region.latitude, longitude: region.longitude };
    if (isValidCoordinates(center)) {
      setPickedCenter(center);
    }
  }, []);

  const handleMapReady = useCallback(() => {
    if (isMountedRef.current && isFocusedRef.current) {
      setMapReady(true);
    }
  }, []);

  const confirmPickerSelection = useCallback(
    async (selection: 'home' | 'custom') => {
      if (!mapReady || pickerConfirmationInFlightRef.current) {
        return;
      }

      const sessionId = pickerSessionIdRef.current;
      const requestIsActive = () =>
        isMountedRef.current &&
        isFocusedRef.current &&
        pickerSessionIdRef.current === sessionId;

      pickerConfirmationInFlightRef.current = true;
      setResolvingCenter(true);
      setPickerError(null);

      try {
        const cameraCenter = await mapRef.current?.getCenter();
        if (!requestIsActive()) {
          return;
        }
        if (!isValidCoordinates(cameraCenter)) {
          setPickerError('場所を確認できませんでした。地図の読み込みを待って、もう一度お試しください。');
          return;
        }

        // この1つの座標オブジェクトを保存・画面状態・Contextで共有する。
        const coordinates: Coordinates = {
          latitude: cameraCenter.latitude,
          longitude: cameraCenter.longitude,
        };
        setPickedCenter(coordinates);
        setResolvingCenter(false);

        if (selection === 'home') {
          setSavingHome(true);
          const saved = await saveHomeLocation(coordinates);
          if (!requestIsActive()) {
            return;
          }
          if (!saved) {
            setPickerError('自宅の登録に失敗しました。場所を選び直して、もう一度お試しください。');
            return;
          }
          setHomeLocation(coordinates);
        }

        if (!requestIsActive()) {
          return;
        }
        setDeparture({
          source: selection,
          coordinates,
          label: selection === 'home' ? '自宅' : '指定した場所',
        });
        setMode('menu');
        router.push('/conditions');
      } catch {
        if (requestIsActive()) {
          setPickerError('場所を確認できませんでした。地図を動かして、もう一度お試しください。');
        }
      } finally {
        if (pickerSessionIdRef.current === sessionId) {
          pickerConfirmationInFlightRef.current = false;
        }
        if (isMountedRef.current && pickerSessionIdRef.current === sessionId) {
          setResolvingCenter(false);
          setSavingHome(false);
        }
      }
    },
    [mapReady, setDeparture]
  );

  const handleSaveHome = useCallback(() => {
    void confirmPickerSelection('home');
  }, [confirmPickerSelection]);

  const handleConfirmCustomLocation = useCallback(() => {
    void confirmPickerSelection('custom');
  }, [confirmPickerSelection]);

  if (mode === 'locating') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <WizardProgressHeader step={1} total={7} />
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#0a7ea4" />
          <Text style={styles.statusText}>現在地を取得しています…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (mode === 'location-denied') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <WizardProgressHeader step={1} total={7} />
        <View style={styles.centerContent}>
          <Text style={styles.statusTitle}>現在地を利用できませんでした</Text>
          <Text style={styles.statusText}>
            位置情報の利用が許可されなかったか、取得に失敗しました。設定から許可するか、他の方法で出発地点を選んでください。
          </Text>
          <View style={styles.stackGap}>
            <PrimaryButton label="もう一度試す" onPress={handleUseCurrentLocation} />
            <PrimaryButton
              label="指定した場所を選ぶ"
              variant="secondary"
              onPress={handleStartCustomPick}
            />
            <PrimaryButton label="戻る" variant="secondary" onPress={() => setMode('menu')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (mode === 'home-register' || mode === 'custom-pick') {
    const isHomeMode = mode === 'home-register';
    const pickerBusy = resolvingCenter || savingHome;
    const pickedCenterIsValid = isValidCoordinates(pickedCenter);
    const confirmDisabled = !mapReady || !pickedCenterIsValid || pickerBusy;
    const confirmLabel = !mapReady
      ? '地図を準備しています…'
      : resolvingCenter
        ? '場所を確認しています…'
        : isHomeMode && savingHome
          ? '登録しています…'
          : isHomeMode
            ? 'この場所を自宅として登録'
            : 'この場所に決定';
    return (
      <SafeAreaView style={styles.safeArea}>
        <WizardProgressHeader step={1} total={7} />
        <View style={styles.pickHeader}>
          <Text style={styles.statusTitle}>
            {isHomeMode ? '自宅の場所を登録' : '出発地点を指定'}
          </Text>
          <Text style={styles.statusText}>
            地図を動かして、中央のピンを{isHomeMode ? '自宅' : '出発したい場所'}に合わせてください。
          </Text>
        </View>
        <DriveMapView
          ref={mapRef}
          style={styles.map}
          initialRegion={pickerRegion}
          showCenterPin
          onRegionChangeComplete={handleRegionChangeComplete}
          onMapReady={handleMapReady}
        />
        {pickerError && <Text style={styles.errorText}>{pickerError}</Text>}
        <View style={styles.pickFooter}>
          <PrimaryButton
            label={confirmLabel}
            onPress={isHomeMode ? handleSaveHome : handleConfirmCustomLocation}
            disabled={confirmDisabled}
          />
          <PrimaryButton
            label="戻る"
            variant="secondary"
            onPress={handleCancelPicker}
            disabled={pickerBusy}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <WizardProgressHeader step={1} total={7} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>出発地点を選んでください</Text>
        <SelectionCard
          title="現在地"
          subtitle="今いる場所から出発します"
          onPress={handleUseCurrentLocation}
        />
        {homeChecked && homeLocation ? (
          <View style={styles.homeCard}>
            <Text style={styles.homeCardTitle}>自宅</Text>
            <Text style={styles.homeCardSubtitle}>登録済みの自宅から出発できます</Text>
            <View style={styles.homeCardActions}>
              <PrimaryButton label="この自宅を使う" onPress={handleUseHome} style={styles.homeCardButton} />
              <PrimaryButton
                label="自宅を変更"
                variant="secondary"
                onPress={handleStartHomeChange}
                style={styles.homeCardButton}
              />
            </View>
          </View>
        ) : (
          <SelectionCard
            title="自宅"
            subtitle={!homeChecked ? '確認しています…' : '地図で自宅の場所を登録します'}
            onPress={handleUseHome}
            disabled={!homeChecked}
          />
        )}
        <SelectionCard
          title="指定した場所"
          subtitle="地図で出発したい場所を指定します"
          onPress={handleStartCustomPick}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flexGrow: 1,
    padding: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#11181C',
    marginBottom: 20,
  },
  homeCard: {
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#d7dee0',
    backgroundColor: '#fff',
    padding: 16,
    marginBottom: 12,
  },
  homeCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#11181C',
    marginBottom: 4,
  },
  homeCardSubtitle: {
    fontSize: 13,
    color: '#5b6770',
    marginBottom: 12,
  },
  homeCardActions: {
    flexDirection: 'row',
    gap: 12,
  },
  homeCardButton: {
    flex: 1,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  statusTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#11181C',
    textAlign: 'center',
  },
  statusText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#5b6770',
    textAlign: 'center',
  },
  stackGap: {
    marginTop: 12,
    gap: 12,
    alignSelf: 'stretch',
  },
  pickHeader: {
    padding: 20,
    paddingBottom: 12,
    gap: 6,
  },
  map: {
    flex: 1,
    marginHorizontal: 20,
  },
  pickFooter: {
    padding: 20,
    gap: 12,
  },
  errorText: {
    color: '#c0392b',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});
