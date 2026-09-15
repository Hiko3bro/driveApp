import { useFocusEffect } from 'expo-router/react-navigation';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MapPointPicker } from '@/components/location/map-point-picker';
import { PrimaryButton } from '@/components/ui/primary-button';
import { DEMO_MAP_REGION } from '@/services/location/coordinates';
import { clearHomeLocation, getHomeLocation, saveHomeLocation } from '@/services/location/home-location-store';
import type { Coordinates, MapRegion } from '@/types/location';

/**
 * 100 Program版ではログイン機能を作らない。プロフィールタブはローカル設定のみ
 * (自宅地点・アプリについて・データ/プライバシーについて)。架空のアカウント情報
 * (氏名・メール・プランなど)は一切表示しない。
 */
export default function ProfileTabScreen() {
  const [homeLocation, setHomeLocation] = useState<Coordinates | null>(null);
  const [checkedHome, setCheckedHome] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getHomeLocation().then((location) => {
        if (active) {
          setHomeLocation(location);
          setCheckedHome(true);
        }
      });
      return () => {
        active = false;
      };
    }, [])
  );

  const handleConfirmHome = (coordinates: Coordinates) => {
    saveHomeLocation(coordinates).then((ok) => {
      if (ok) {
        setHomeLocation(coordinates);
      }
      setShowPicker(false);
    });
  };

  const handleClearHome = () => {
    Alert.alert('自宅の登録を削除しますか?', 'この操作は元に戻せません。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除する',
        style: 'destructive',
        onPress: () => {
          clearHomeLocation().then(() => setHomeLocation(null));
        },
      },
    ]);
  };

  if (showPicker) {
    const initialRegion: MapRegion = homeLocation
      ? { ...homeLocation, latitudeDelta: 0.03, longitudeDelta: 0.03 }
      : DEMO_MAP_REGION;
    return (
      <MapPointPicker
        title="自宅の場所を指定"
        instruction="地図を動かして、中央のピンを自宅の場所に合わせてください。"
        initialRegion={initialRegion}
        onCancel={() => setShowPicker(false)}
        onConfirm={handleConfirmHome}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>プロフィール</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>自宅地点</Text>
          <View style={styles.card}>
            <Text style={styles.cardText} accessibilityLabel={homeLocation ? '自宅は登録済みです' : '自宅は未登録です'}>
              {checkedHome ? (homeLocation ? '登録済み' : '未登録') : '確認しています…'}
            </Text>
            <Text style={styles.cardHint}>
              出発地点選択画面の「自宅」で使われます。緯度経度などの詳しい位置情報はここには表示しません。
            </Text>
            <View style={styles.buttonRow}>
              <PrimaryButton
                label={homeLocation ? '自宅を変更' : '自宅を登録'}
                variant="secondary"
                onPress={() => setShowPicker(true)}
              />
              {homeLocation && <PrimaryButton label="自宅の登録を削除" variant="secondary" onPress={handleClearHome} />}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>アプリについて</Text>
          <View style={styles.card}>
            <Text style={styles.cardText}>ドライブ発見(100 Program版)</Text>
            <Text style={styles.cardHint}>
              移動そのものを発見と思い出に変える、ドライブ計画アプリです。ログイン・アカウント登録は不要です。
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>データ/プライバシーについて</Text>
          <View style={styles.card}>
            <Text style={styles.cardHint}>
              出発地点・条件・ドライブ記録・日記・旅行プランは、すべてこの端末内にのみ保存されます。他のユーザーへの公開や、外部のアカウントサーバーへの送信は行いません。{'\n\n'}
              「AIに追加で伝えたいこと」の解釈のみ、抽象化した希望をSupabase Edge Function経由でOpenAIへ送信します(緯度経度・住所は送信しません)。Google
              Places/Google Routesには、ルート・スポット検索に必要な範囲でのみ座標を送信します。
            </Text>
          </View>
        </View>
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
    paddingTop: 20,
    gap: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#11181C',
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#11181C',
  },
  card: {
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#d7dee0',
    backgroundColor: '#fff',
    padding: 16,
    gap: 8,
  },
  cardText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#11181C',
  },
  cardHint: {
    fontSize: 13,
    lineHeight: 19,
    color: '#5b6770',
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
});
