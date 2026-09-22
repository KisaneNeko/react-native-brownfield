import '../BrownfieldStore.brownie';

import { NavigationContainer } from '@react-navigation/native';
import { useEffect } from 'react';
import {
  syncBrownfieldE2EModeFromRootProps,
  type BrownfieldRootProps,
} from '@callstack/brownfield-example-shared-tests/runtime';

import { HomeScreen } from './HomeScreen';
import {
  NativeOsVersionLabelContext,
  SurfaceTagContext,
} from './nativeHostContext';
import { Stack } from './navigation/RootStack';

type AppProps = BrownfieldRootProps;

export default function App({
  nativeOsVersionLabel,
  brownfieldE2E,
  surfaceTag,
}: AppProps) {
  useEffect(() => {
    syncBrownfieldE2EModeFromRootProps(brownfieldE2E);
    return () => syncBrownfieldE2EModeFromRootProps(undefined);
  }, [brownfieldE2E]);

  return (
    <NativeOsVersionLabelContext.Provider value={nativeOsVersionLabel}>
      <SurfaceTagContext.Provider value={surfaceTag}>
        <NavigationContainer>
          <Stack.Navigator>
            <Stack.Screen name="Home" component={HomeScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </SurfaceTagContext.Provider>
    </NativeOsVersionLabelContext.Provider>
  );
}
