declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

interface ImportMetaEnv {
  /** 'solo' for the stand-alone analysis app; unset for the team platform. */
  readonly VITE_EDITION?: 'solo';
}
