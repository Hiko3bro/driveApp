import { useEffect, useState } from 'react';
import { getPlacePhotoUri, type PlacePhotoRef } from '@/services/spot/google-places-client';

/**
 * Place写真のセッション内クライアントキャッシュ。永続化はしない(アプリ再起動で消える)。
 * Upstash等の共有キャッシュは使わない(1端末内で表示された候補分だけをキャッシュすれば
 * 十分という判断、Search Session Cache(サーバー側、Spot Pool用)とは別レイヤー)。
 *
 * キャッシュキーはplaceId(Google Places Photos利用ポリシーで「Place IDはキャッシュ制限の
 * 適用除外」と明記されているキー)。photoName(Photo Media API固有の参照文字列)は同一の
 * 実在Placeでも検索タイミングによって値が変わりうる不安定なキーのため使わない。
 * 写真本体(photoUri)は長期保存せず、TTL付きのメモリ内キャッシュのみで扱う。
 *
 * 【lazy load方針】useCandidatePhotoは呼び出し元が渡すvisible=trueになるまでは
 * 一切fetchを発生させない(queueへも積まない)。画面に実際に見えているCard(+直後に
 * 見えそうな1件程度)だけがfetchを要求する、という「本当のlazy load」をこのフック1箇所で
 * 保証する(実機で「非表示のPlaceまで写真取得が発生する」「候補を開いた瞬間に全件queueへ
 * 積まれる」不具合の修正)。
 */

const CACHE_TTL_MS = 20 * 60 * 1000;
/** 同時に実行するPhoto Media fetchの上限。Spot検索本体の帯域・予算を圧迫しないための緩いqueue。 */
const MAX_CONCURRENT_FETCHES = 2;
/** 1セッションあたりのPhoto Media fetch上限。超えた分はAPIを呼ばずplaceholder表示へ倒す(Spot検索自体は継続)。 */
const MAX_PHOTO_FETCHES_PER_SESSION = 14;

type CachedPhoto =
  | { status: 'available'; photoUri: string; attributions: string[]; fetchedAt: number }
  | { status: 'unavailable'; fetchedAt: number };

const photoCache = new Map<string, CachedPhoto>();
const inFlightFetches = new Map<string, Promise<CachedPhoto>>();
/** 一度でも要求された(=devStats.visibleRequestCountの対象になった)placeIdの集合。件数のみログへ出す。 */
const requestedPlaceIds = new Set<string>();

type QueueEntry = { placeId: string; run: () => void };
const highPriorityQueue: QueueEntry[] = [];
const lowPriorityQueue: QueueEntry[] = [];
let activeFetchCount = 0;
let sessionFetchCount = 0;

const devStats = {
  /** 実際にGoogle Photo Media APIへ到達したfetch数(session上限・cache・in-flight dedupを抜けた実回数)。 */
  fetches: 0,
  cacheHits: 0,
  cacheMisses: 0,
  /** 実fetchの結果「写真なし/取得失敗」だった数(sessionSkippedとは別)。 */
  unavailable: 0,
  queued: 0,
  skippedBySessionLimit: 0,
  inFlightDedupHits: 0,
  /** 可視化されてuseCandidatePhotoが実際にresolveCachedPhotoを呼んだ回数(cache hit等も含む総量)。 */
  visibleRequestCount: 0,
  /** 同時にqueueへ積まれていた最大件数(concurrency制御の効果を確認する目安)。 */
  maxQueueSize: 0,
};

/** __DEV__時のみ、件数だけを出す(Place名・座標・APIキー・URLは一切含めない)。 */
function logPhotoCacheStats(): void {
  if (__DEV__) {
    console.log(
      `[place-photo-cache] actualNetworkFetches=${devStats.fetches} uniquePlaces=${requestedPlaceIds.size} cacheHits=${devStats.cacheHits} misses=${devStats.cacheMisses} unavailable=${devStats.unavailable} queued=${devStats.queued} skippedBySessionLimit=${devStats.skippedBySessionLimit} inFlightDedupHits=${devStats.inFlightDedupHits} visibleRequestCount=${devStats.visibleRequestCount} maxQueueSize=${devStats.maxQueueSize}`
    );
  }
}

function isFresh(entry: CachedPhoto): boolean {
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

/** キューに空きができ次第、優先度の高いものから順に実行する。 */
function pumpQueue(): void {
  while (activeFetchCount < MAX_CONCURRENT_FETCHES) {
    const next = highPriorityQueue.shift() ?? lowPriorityQueue.shift();
    if (!next) {
      return;
    }
    activeFetchCount++;
    next.run();
  }
}

/**
 * 1件のPlace写真をqueue・concurrency制御・session上限・unavailableキャッシュを通して解決する。
 * 表示された候補分だけ・1Place1枚・同一Placeは1セッション中に1回だけ実fetch、という方針を
 * この関数1箇所に集約する。呼び出し元(useCandidatePhoto)がvisible=trueの間だけこれを呼ぶ。
 */
function resolveCachedPhoto(placeId: string, photoName: string, priority: 'high' | 'low', maxWidthPx?: number): Promise<CachedPhoto> {
  devStats.visibleRequestCount++;
  requestedPlaceIds.add(placeId);

  const cached = photoCache.get(placeId);
  if (cached && isFresh(cached)) {
    devStats.cacheHits++;
    logPhotoCacheStats();
    return Promise.resolve(cached);
  }

  const inFlight = inFlightFetches.get(placeId);
  if (inFlight) {
    devStats.inFlightDedupHits++;
    logPhotoCacheStats();
    return inFlight;
  }

  if (sessionFetchCount >= MAX_PHOTO_FETCHES_PER_SESSION) {
    devStats.skippedBySessionLimit++;
    logPhotoCacheStats();
    const unavailable: CachedPhoto = { status: 'unavailable', fetchedAt: Date.now() };
    // session上限による未取得は、TTL相当のあいだ同じ判定を再利用してよいが、次のセッション
    // (アプリ再起動)まで固定するものではないため、通常のunavailableと同じ扱いでキャッシュする。
    photoCache.set(placeId, unavailable);
    return Promise.resolve(unavailable);
  }

  devStats.cacheMisses++;
  devStats.queued++;
  logPhotoCacheStats();

  const promise = new Promise<CachedPhoto>((resolve) => {
    const run = () => {
      devStats.fetches++;
      sessionFetchCount++;
      logPhotoCacheStats();
      void getPlacePhotoUri(photoName, maxWidthPx)
        .then((outcome) => {
          const result: CachedPhoto = outcome.ok
            ? { status: 'available', photoUri: outcome.photoUri, attributions: [], fetchedAt: Date.now() }
            : { status: 'unavailable', fetchedAt: Date.now() };
          if (!outcome.ok) {
            devStats.unavailable++;
          }
          photoCache.set(placeId, result);
          logPhotoCacheStats();
          resolve(result);
        })
        .finally(() => {
          activeFetchCount--;
          inFlightFetches.delete(placeId);
          pumpQueue();
        });
    };

    if (priority === 'high') {
      highPriorityQueue.push({ placeId, run });
    } else {
      lowPriorityQueue.push({ placeId, run });
    }
    devStats.maxQueueSize = Math.max(devStats.maxQueueSize, highPriorityQueue.length + lowPriorityQueue.length);
    pumpQueue();
  });

  inFlightFetches.set(placeId, promise);
  return promise;
}

export type CandidatePhotoState =
  | { status: 'idle' | 'loading' }
  | { status: 'available'; photoUri: string; attributions: string[] }
  | { status: 'unavailable' };

/**
 * 候補カードが画面に「実際に見えている」間だけ写真を取得するフック。
 *
 * visible=falseの間はresolveCachedPhoto自体を呼ばない(queueへも積まない、'idle'のまま
 * プレースホルダー表示になる)。visibleがfalse→trueへ変わった時点で初めてfetchを要求する。
 * 一度でも要求してsuccess/unavailable/sessionSkippedのいずれかに確定した後は、visibleが
 * false→true→falseと変化しても再要求しない(photoCache/inFlightFetchesのplaceIdキーによる
 * 冪等性で保証される)。photoRefがnullの場合は visible に関わらず何もフェッチせず即座に
 * 'unavailable'を返す(=カード側はプレースホルダー表示)。
 *
 * placeIdでキャッシュ・in-flight重複防止・session上限を管理し、priorityでqueueの順番を
 * 決める(画面上で最初に見える2〜3件は'high'、それ以外は'low'を呼び出し元が渡す)。
 */
export function useCandidatePhoto(
  placeId: string,
  photoRef: PlacePhotoRef | null,
  visible: boolean,
  priority: 'high' | 'low' = 'high',
  maxWidthPx?: number
): CandidatePhotoState {
  const [state, setState] = useState<CandidatePhotoState>(photoRef ? { status: 'idle' } : { status: 'unavailable' });

  useEffect(() => {
    if (!photoRef) {
      setState({ status: 'unavailable' });
      return;
    }
    if (!visible) {
      // 非表示の間は何もfetchしない。既に確定済みの結果があれば、可視化されたeffectが
      // resolveCachedPhoto経由でcache hitとして即座に拾う(ここでは何もしない)。
      return;
    }

    let cancelled = false;
    setState((prev) => (prev.status === 'available' ? prev : { status: 'loading' }));

    resolveCachedPhoto(placeId, photoRef.name, priority, maxWidthPx).then((result) => {
      if (cancelled) {
        return;
      }
      setState(
        result.status === 'available'
          ? { status: 'available', photoUri: result.photoUri, attributions: photoRef.attributions }
          : { status: 'unavailable' }
      );
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeId, photoRef?.name, visible, priority, maxWidthPx]);

  return state;
}
