/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FB_API_KEY?: string;
  readonly VITE_FB_AUTH_DOMAIN?: string;
  readonly VITE_FB_PROJECT_ID?: string;
  readonly VITE_FB_APP_ID?: string;
  /** host of the local Firebase emulators (tests / offline dev) */
  readonly VITE_FB_EMULATOR?: string;
  /** the Firestore emulator's port (default 8080), for a second emulator on the same host */
  readonly VITE_FB_FS_PORT?: string;
  /** the Auth emulator's port (default 9099) */
  readonly VITE_FB_AUTH_PORT?: string;
}
