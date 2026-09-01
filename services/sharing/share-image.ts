import * as Sharing from 'expo-sharing';
import type { RefObject } from 'react';
import type { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

export type ShareCardResult =
  | { status: 'shared' }
  | { status: 'unavailable' }
  | { status: 'error' };

/**
 * 共有カードのViewを画像化し、OSの共有シート(Instagram/LINE/AirDrop/保存等)へ渡す。
 * 画像化・共有シートの起動どちらも失敗しうるため例外は投げず、呼び出し側(共有画面)が
 * エラーメッセージを表示して再試行できるようにする。Instagram等の専用APIは使わず、
 * OS標準の共有機能(expo-sharing)のみを利用する。
 */
export async function shareCardView(
  viewRef: RefObject<View | null>,
  dialogTitle: string
): Promise<ShareCardResult> {
  if (!viewRef.current) {
    return { status: 'error' };
  }

  try {
    const uri = await captureRef(viewRef, { format: 'png', quality: 0.92, result: 'tmpfile' });

    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      return { status: 'unavailable' };
    }

    await Sharing.shareAsync(uri, {
      mimeType: 'image/png',
      UTI: 'public.png',
      dialogTitle,
    });
    return { status: 'shared' };
  } catch {
    return { status: 'error' };
  }
}
