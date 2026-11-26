/** Types for `eui-devtools.mjs`, for the test that starts it. */
export declare const PAGE_PORT: number
export declare const PHONE_PORT: number
export declare const startRelay: (options?: {
  port?: number
  to?: number
  host?: string
}) => Promise<{ port: number; close: () => Promise<void> }>
export declare const lanAddresses: () => Array<string>
export declare const start: (options?: {
  /** The folder whose `node_modules` holds `@effect/ui-devtools`. */
  from?: string
  port?: number
  phonePort?: number
  /** `false`: the relay listens on this Mac only. */
  phone?: boolean
  dispatch?: boolean
  size?: number
  keep?: number
}) => Promise<{ url: string; mcp: string; phonePort: number; stop: () => Promise<void> }>
