import { registerRootComponent } from 'react-native';

import App from './App';

// registerRootComponent ensures the environment is set up consistently
// whether the app runs in Expo Go or a native build.
registerRootComponent(App);
