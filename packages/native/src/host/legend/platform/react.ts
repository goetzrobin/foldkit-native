/**
 * Stands in for the `react` package in Legend's type files.
 *
 * Legend's core never calls React, but its type files name a few React types
 * (what `renderItem` returns, a ref to the scroll view) and one file wraps
 * `React.memo` and `React.forwardRef` for its components, which are not
 * vendored. This file gives those names a meaning without React:
 * a "node" is whatever our rows are (a Foldkit element), a ref is an object
 * with `current`, and `memo` and `forwardRef` hand back what they are given.
 */
export type Key = string | number | bigint
export type ReactNode = unknown
export type ReactElement<_Props = unknown> = unknown
export type ComponentType<_Props = unknown> = (props: any) => unknown
export type ComponentProps<_Component> = any
export type RefObject<T> = { current: T }
export type MutableRefObject<T> = { current: T }
export type Ref<T> = RefObject<T | null> | ((instance: T | null) => void) | null
export type RefAttributes<T> = { ref?: Ref<T> }
export type ForwardedRef<T> = Ref<T>
export type CSSProperties = Record<string, unknown>
export type HTMLAttributes<_Element> = Record<string, unknown>

export const forwardRef = (render: unknown): unknown => render
export const memo = (component: unknown): unknown => component
