/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ViteTypeOptions {
  // By adding this line, you can make the type of ImportMetaEnv strict
  // to disallow unknown keys.
  // strictImportMetaEnv: unknown
}

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  /** Map edge base URL (`<origin>/maps`). Defaults to the API origin. */
  readonly VITE_MAPS_URL?: string;
  /** Base64url VAPID public key for Web Push. Public by design. */
  readonly VITE_VAPID_PUBLIC_KEY: string;
  // more env variables...
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
