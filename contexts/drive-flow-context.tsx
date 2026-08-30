import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { DriveConditions } from '@/types/drive';
import type { DepartureSelection } from '@/types/location';
import type { RouteOption } from '@/types/route';

interface DriveFlowState {
  departure: DepartureSelection | null;
  conditions: DriveConditions | null;
  routes: RouteOption[];
  selectedRouteId: string | null;
}

interface DriveFlowContextValue extends DriveFlowState {
  setDeparture: (departure: DepartureSelection) => void;
  setConditions: (conditions: DriveConditions) => void;
  setRoutes: (routes: RouteOption[]) => void;
  setSelectedRouteId: (routeId: string) => void;
  reset: () => void;
}

const initialState: DriveFlowState = {
  departure: null,
  conditions: null,
  routes: [],
  selectedRouteId: null,
};

const DriveFlowContext = createContext<DriveFlowContextValue | null>(null);

export function DriveFlowProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DriveFlowState>(initialState);

  const setDeparture = useCallback((departure: DepartureSelection) => {
    setState((prev) => ({ ...prev, departure }));
  }, []);

  const setConditions = useCallback((conditions: DriveConditions) => {
    setState((prev) => ({ ...prev, conditions }));
  }, []);

  const setRoutes = useCallback((routes: RouteOption[]) => {
    setState((prev) => ({ ...prev, routes, selectedRouteId: routes[0]?.id ?? null }));
  }, []);

  const setSelectedRouteId = useCallback((routeId: string) => {
    setState((prev) => ({ ...prev, selectedRouteId: routeId }));
  }, []);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  const value = useMemo<DriveFlowContextValue>(
    () => ({ ...state, setDeparture, setConditions, setRoutes, setSelectedRouteId, reset }),
    [state, setDeparture, setConditions, setRoutes, setSelectedRouteId, reset]
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
