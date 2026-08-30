export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface MapRegion extends Coordinates {
  latitudeDelta: number;
  longitudeDelta: number;
}

export type DepartureSource = 'current' | 'home' | 'custom';

export interface DepartureSelection {
  source: DepartureSource;
  coordinates: Coordinates;
  label: string;
}
