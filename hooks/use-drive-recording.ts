import { useCallback, useEffect, useRef, useState } from 'react';

import { haversineDistanceKm } from '@/services/location/coordinates';
import { requestCurrentLocation } from '@/services/location/current-location';
import { createDemoPositionSampler } from '@/services/location/drive-demo-simulator';
import type { Coordinates } from '@/types/location';
import type { DriveRecordingSource, RecordedTrackPoint } from '@/types/drive-recording';

/** GPS/デモ座標を記録する間隔。「一定間隔で記録」の要件を満たすための固定ポーリング間隔。 */
const SAMPLE_INTERVAL_MS = 5000;
const TIMER_TICK_MS = 1000;

export type DriveRecordingStatus = 'idle' | 'recording' | 'stopped';

export interface DriveRecordingFinishedResult {
  track: RecordedTrackPoint[];
  distanceKm: number;
  durationSeconds: number;
  startedAt: number;
  endedAt: number;
  source: DriveRecordingSource;
}

interface UseDriveRecordingParams {
  /** デモ走行モードで辿らせる経路(選択中ルートのroute.pathを渡す)。 */
  demoPath: Coordinates[];
}

/**
 * ドライブ記録画面の記録ロジック本体。実GPS(expo-location)を優先し、
 * 許可拒否・取得失敗などで実GPSが使えない場合は自動的にデモ走行モードへフォールバックする。
 * 本番のバックグラウンド記録は行わず、画面表示中(フォアグラウンド)のみ記録する。
 */
export function useDriveRecording({ demoPath }: UseDriveRecordingParams) {
  const [status, setStatus] = useState<DriveRecordingStatus>('idle');
  const [source, setSource] = useState<DriveRecordingSource | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [distanceKm, setDistanceKm] = useState(0);
  const [currentLocation, setCurrentLocation] = useState<Coordinates | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const trackRef = useRef<RecordedTrackPoint[]>([]);
  const distanceRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const sourceRef = useRef<DriveRecordingSource | null>(null);
  const sampleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSamplingRef = useRef(false);
  const isStartingRef = useRef(false);
  const demoSamplerRef = useRef(createDemoPositionSampler(demoPath));

  useEffect(() => {
    demoSamplerRef.current = createDemoPositionSampler(demoPath);
  }, [demoPath]);

  const clearTimers = useCallback(() => {
    if (sampleTimerRef.current) {
      clearInterval(sampleTimerRef.current);
      sampleTimerRef.current = null;
    }
    if (timerTimerRef.current) {
      clearInterval(timerTimerRef.current);
      timerTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const appendPoint = useCallback((coordinates: Coordinates) => {
    const previous = trackRef.current[trackRef.current.length - 1];
    trackRef.current = [...trackRef.current, { coordinates, recordedAt: Date.now() }];
    setCurrentLocation(coordinates);
    if (previous) {
      distanceRef.current += haversineDistanceKm(previous.coordinates, coordinates);
      setDistanceKm(distanceRef.current);
    }
  }, []);

  const sampleOnce = useCallback(async () => {
    if (isSamplingRef.current) {
      return;
    }
    isSamplingRef.current = true;
    try {
      if (sourceRef.current === 'gps') {
        const result = await requestCurrentLocation();
        if (result.status === 'granted') {
          appendPoint(result.coordinates);
        }
        // 記録中に一時的にGPSが取得できなかった場合も、直前の記録点を保持したまま継続する。
        return;
      }
      const elapsedMs = startedAtRef.current ? Date.now() - startedAtRef.current : 0;
      appendPoint(demoSamplerRef.current(elapsedMs));
    } finally {
      isSamplingRef.current = false;
    }
  }, [appendPoint]);

  const start = useCallback(async () => {
    if (status === 'recording' || isStartingRef.current) {
      return;
    }
    isStartingRef.current = true;

    trackRef.current = [];
    distanceRef.current = 0;
    setDistanceKm(0);
    setElapsedSeconds(0);
    setNotice(null);

    try {
      const initial = await requestCurrentLocation();
      const resolvedSource: DriveRecordingSource = initial.status === 'granted' ? 'gps' : 'demo';
      sourceRef.current = resolvedSource;
      setSource(resolvedSource);
      if (resolvedSource === 'demo') {
        setNotice(
          initial.status === 'denied'
            ? '位置情報の利用が許可されていないため、デモ走行モードで記録します。'
            : '現在地を取得できないため、デモ走行モードで記録します。'
        );
      }

      const startedAt = Date.now();
      startedAtRef.current = startedAt;
      setStatus('recording');

      appendPoint(initial.status === 'granted' ? initial.coordinates : demoSamplerRef.current(0));

      sampleTimerRef.current = setInterval(() => {
        void sampleOnce();
      }, SAMPLE_INTERVAL_MS);
      timerTimerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
      }, TIMER_TICK_MS);
    } finally {
      isStartingRef.current = false;
    }
  }, [status, appendPoint, sampleOnce]);

  const stop = useCallback((): DriveRecordingFinishedResult | null => {
    if (status !== 'recording' || startedAtRef.current === null || sourceRef.current === null) {
      return null;
    }
    clearTimers();
    const endedAt = Date.now();
    const result: DriveRecordingFinishedResult = {
      track: trackRef.current,
      distanceKm: distanceRef.current,
      durationSeconds: Math.max(0, Math.floor((endedAt - startedAtRef.current) / 1000)),
      startedAt: startedAtRef.current,
      endedAt,
      source: sourceRef.current,
    };
    setStatus('stopped');
    return result;
  }, [status, clearTimers]);

  return {
    status,
    source,
    elapsedSeconds,
    distanceKm,
    currentLocation,
    notice,
    start,
    stop,
  };
}
