import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const INSTALL_ID_KEY = 'drive-discovery.install-id';

let cachedInstallId: string | null = null;

/**
 * 端末(アプリインストール)単位の匿名IDを取得する。ユーザーアカウントや
 * 端末固有のハードウェアIDとは無関係で、Supabase Edge Function側の
 * レート制限のためだけに使う値。初回のみexpo-cryptoで暗号学的に安全な
 * UUID v4を生成し、expo-secure-storeへ保存して以降も同じ値を再利用する。
 * この値をログやUIへ出力してはいけない。
 */
export async function getInstallId(): Promise<string> {
  if (cachedInstallId) {
    return cachedInstallId;
  }

  try {
    const stored = await SecureStore.getItemAsync(INSTALL_ID_KEY);
    if (stored) {
      cachedInstallId = stored;
      return stored;
    }
  } catch {
    // secure-storeが利用できない環境(例: Web)では毎回新規生成にフォールバックする
  }

  const generated = Crypto.randomUUID();
  cachedInstallId = generated;

  try {
    await SecureStore.setItemAsync(INSTALL_ID_KEY, generated);
  } catch {
    // 保存に失敗しても、このアプリ起動中はcachedInstallIdで一貫した値を使い続けられる
  }

  return generated;
}
