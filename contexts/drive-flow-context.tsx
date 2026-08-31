import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { isValidCoordinates } from '@/services/location/coordinates';
import type { DriveConditions } from '@/types/drive';
import type { DepartureSelection } from '@/types/location';
import type { RouteOption } from '@/types/route';
import { MAX_SELECTED_SPOTS, type Spot } from '@/types/spot';

interface DriveFlowState {
  departure: DepartureSelection | null;
  conditions: DriveConditions | null;
  routes: RouteOption[];
  selectedRouteId: string | null;
  spotRouteId: string | null;
  spots: Spot[];
  selectedSpotId: string | null;
  selectedSpotIds: string[];
}

interface DriveFlowContextValue extends DriveFlowState {
  setDeparture: (departure: DepartureSelection) => void;
  setConditions: (conditions: DriveConditions) => void;
  setRoutes: (routes: RouteOption[]) => void;
  setSelectedRouteId: (routeId: string) => void;
  initializeSpotDiscovery: (routeId: string, spots: Spot[]) => void;
  setSelectedSpotId: (routeId: string, spotId: string) => void;
  setSelectedSpotIds: (routeId: string, spotIds: string[]) => void;
  reset: () => void;
}

const emptySpotState = {
  spotRouteId: null,
  spots: [] as Spot[],
  selectedSpotId: null,
  selectedSpotIds: [] as string[],
};

const initialState: DriveFlowState = {
  departure: null,
  conditions: null,
  routes: [],
  selectedRouteId: null,
  ...emptySpotState,
};

const DriveFlowContext = createContext<DriveFlowContextValue | null>(null);

export function DriveFlowProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DriveFlowState>(initialState);

  const setDeparture = useCallback((departure: DepartureSelection) => {
    if (!isValidCoordinates(departure.coordinates)) {
      return;
    }
    setState((prev) => ({ ...prev, departure }));
  }, []);

  const setConditions = useCallback((conditions: DriveConditions) => {
    setState((prev) => ({ ...prev, conditions }));
  }, []);

  const setRoutes = useCallback((routes: RouteOption[]) => {
    setState((prev) => ({
      ...prev,
      routes,
      selectedRouteId: routes[0]?.id ?? null,
      ...emptySpotState,
    }));
  }, []);

  const setSelectedRouteId = useCallback((routeId: string) => {
    setState((prev) => {
      if (!prev.routes.some((route) => route.id === routeId)) {
        return prev;
      }
      if (prev.selectedRouteId === routeId) {
        return prev;
      }
      return { ...prev, selectedRouteId: routeId, ...emptySpotState };
    });
  }, []);

  const initializeSpotDiscovery = useCallback((routeId: string, spots: Spot[]) => {
    setState((prev) => {
      if (!prev.routes.some((route) => route.id === routeId)) {
        return prev;
      }

      const uniqueSpots = spots.filter(
        (spot, index, all) =>
          spot.isMock &&
          isValidCoordinates(spot.coordinates) &&
          Number.isFinite(spot.extraMinutes) &&
          spot.extraMinutes >= 0 &&
          Number.isFinite(spot.extraDistanceKm) &&
          spot.extraDistanceKm >= 0 &&
          all.findIndex((candidate) => candidate.id === spot.id) === index
      );
      const validIds = new Set(uniqueSpots.map((spot) => spot.id));

      if (prev.spotRouteId !== routeId) {
        return {
          ...prev,
          spotRouteId: routeId,
          spots: uniqueSpots,
          selectedSpotId: uniqueSpots[0]?.id ?? null,
          selectedSpotIds: [],
        };
      }

      const selectedSpotIds = prev.selectedSpotIds
        .filter((id) => validIds.has(id))
        .slice(0, MAX_SELECTED_SPOTS);
      return {
        ...prev,
        spots: uniqueSpots,
        selectedSpotId:
          prev.selectedSpotId && validIds.has(prev.selectedSpotId)
            ? prev.selectedSpotId
            : uniqueSpots[0]?.id ?? null,
        selectedSpotIds,
      };
    });
  }, []);

  const setSelectedSpotId = useCallback((routeId: string, spotId: string) => {
    setState((prev) => {
      if (prev.spotRouteId !== routeId || !prev.spots.some((spot) => spot.id === spotId)) {
        return prev;
      }
      return prev.selectedSpotId === spotId ? prev : { ...prev, selectedSpotId: spotId };
    });
  }, []);

  const setSelectedSpotIds = useCallback((routeId: string, spotIds: string[]) => {
    setState((prev) => {
      if (prev.spotRouteId !== routeId || spotIds.length > MAX_SELECTED_SPOTS) {
        return prev;
      }

      const uniqueIds = [...new Set(spotIds)];
      const knownIds = new Set(prev.spots.map((spot) => spot.id));
      if (uniqueIds.length !== spotIds.length || uniqueIds.some((id) => !knownIds.has(id))) {
        return prev;
      }

      return { ...prev, selectedSpotIds: uniqueIds };
    });
  }, []);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  const value = useMemo<DriveFlowContextValue>(
    () => ({
      ...state,
      setDeparture,
      setConditions,
      setRoutes,
      setSelectedRouteId,
      initializeSpotDiscovery,
      setSelectedSpotId,
      setSelectedSpotIds,
      reset,
    }),
    [
      state,
      setDeparture,
      setConditions,
      setRoutes,
      setSelectedRouteId,
      initializeSpotDiscovery,
      setSelectedSpotId,
      setSelectedSpotIds,
      reset,
    ]
  );

  return <DriveFlowContext.Provider value={value}>{children}</DriveFlowContext.Provider>;
}

export function useDriveFlow(): DriveFlowContextValue {
  const context = useContext(DriveFlowContext);
  if (!context) {
    throw new Error('useDriveFlow must be used within a DriveFlowProvider');
  }
  return context;
}
