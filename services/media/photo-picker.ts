import * as ImagePicker from 'expo-image-picker';

import type { DiaryPhoto } from '@/types/drive-diary';

export type PickDiaryPhotosResult =
  | { status: 'picked'; photos: DiaryPhoto[] }
  | { status: 'canceled' }
  | { status: 'denied' }
  | { status: 'unavailable' };

function createPhotoId(): string {
  return `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 端末の写真ライブラリから最大selectionLimit枚を選ぶ。Expo Go・権限拒否・機能非対応など
 * 写真選択自体が使えない環境でも例外を投げず、呼び出し側(日記作成画面)が処理を継続できるようにする。
 */
export async function pickDiaryPhotos(selectionLimit: number): Promise<PickDiaryPhotosResult> {
  if (selectionLimit <= 0) {
    return { status: 'canceled' };
  }

  try {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') {
      return { status: 'denied' };
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit,
      quality: 0.8,
    });

    if (result.canceled) {
      return { status: 'canceled' };
    }

    const photos: DiaryPhoto[] = result.assets.slice(0, selectionLimit).map((asset) => ({
      id: createPhotoId(),
      uri: asset.uri,
      width: Number.isFinite(asset.width) && asset.width > 0 ? asset.width : null,
      height: Number.isFinite(asset.height) && asset.height > 0 ? asset.height : null,
    }));

    return { status: 'picked', photos };
  } catch {
    return { status: 'unavailable' };
  }
}
