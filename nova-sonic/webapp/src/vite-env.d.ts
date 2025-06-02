/// <reference types="vite/client" />

interface ImportMeta {
  readonly env: {
    readonly VITE_API_ENDPOINT?: string;
    readonly [key: string]: string | undefined;
  }
}