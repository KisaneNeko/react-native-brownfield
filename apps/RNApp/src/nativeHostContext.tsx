import { createContext, useContext } from 'react';

export const NativeOsVersionLabelContext = createContext<string | undefined>(
  undefined
);

export function useNativeOsVersionLabel(): string | undefined {
  return useContext(NativeOsVersionLabelContext);
}

export const SurfaceTagContext = createContext<string | undefined>(undefined);

export function useSurfaceTag(): string | undefined {
  return useContext(SurfaceTagContext);
}
