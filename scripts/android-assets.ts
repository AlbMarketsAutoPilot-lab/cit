// Copies the built app into the Android project (run by: npm run android:assets).
import { copyFileSync, mkdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
mkdirSync(new URL('android/app/src/main/assets/', root), { recursive: true });
copyFileSync(new URL('dist/index.html', root), new URL('android/app/src/main/assets/index.html', root));
