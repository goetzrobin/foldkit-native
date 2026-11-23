/**
 * A stack of routes kept in the Model, and the view that draws it.
 *
 * A route is whatever the program says a screen is, usually a tagged union:
 *
 *   type Route = { _tag: 'List' } | { _tag: 'Detail', id: number }
 *
 * The Model holds an array of them, the first at the bottom and the last on
 * top. It is never empty: the first route is the screen you cannot go back
 * from. `update` changes the array with the functions here, and the view
 * hands it to `stackOf`:
 *
 *   PressedRow: ({ id }) => ({ model: { ...model, routes: push(model.routes, Detail({ id })) } }),
 *   PressedBack: () => ({ model: { ...model, routes: pop(model.routes) } }),
 *   PoppedByPhone: ({ count }) => ({ model: { ...model, routes: popByPhone(model.routes, count) } }),
 *
 *   stackOf(h, model.routes, {
 *     key: route => route._tag,
 *     onPoppedByPhone: count => PoppedByPhone({ count }),
 *     screen: (route, place) => ({ children: [...] }),
 *   })
 *
 * Every function returns a new array and none removes the first route.
 */
import type { Html, HtmlBuilder } from 'foldkit/html'

import { type Attributes, modalScreen, onDismissed, screen, stack } from './stack'

/** The routes open in one stack, the last on top. Never empty. */
export type Routes<Route> = ReadonlyArray<Route>

/** Puts a route on top. */
export const push = <Route>(routes: Routes<Route>, route: Route): Routes<Route> => [
  ...routes,
  route,
]

/** Takes `count` routes off the top, and never the first one. */
export const pop = <Route>(routes: Routes<Route>, count = 1): Routes<Route> =>
  routes.slice(0, Math.max(1, routes.length - Math.max(0, count)))

/** Back to the first route. */
export const popToRoot = <Route>(routes: Routes<Route>): Routes<Route> => routes.slice(0, 1)

/**
 * Pops down to the nearest route below the top that matches, which then is
 * the top. With no match the stack is left as it is.
 */
export const popTo = <Route>(
  routes: Routes<Route>,
  isTarget: (route: Route) => boolean,
): Routes<Route> => {
  for (let index = routes.length - 2; index >= 0; index--) {
    if (isTarget(routes[index] as Route)) return routes.slice(0, index + 1)
  }
  return routes
}

/** Swaps the top route for another. Give the two different keys. */
export const replace = <Route>(routes: Routes<Route>, route: Route): Routes<Route> => [
  ...routes.slice(0, -1),
  route,
]

/**
 * The phone has already closed `count` screens (a swipe-back, a sheet dragged
 * down). Drops the same routes so the Model agrees with the phone.
 */
export const popByPhone = <Route>(routes: Routes<Route>, count: number): Routes<Route> =>
  pop(routes, count)

/** Whether there is a screen to go back from. */
export const canPop = <Route>(routes: Routes<Route>): boolean => routes.length > 1

/** Where a route sits in its stack, for the view of its screen. */
export type Place = Readonly<{
  /** 0 for the first route. */
  index: number
  isRoot: boolean
  isTop: boolean
}>

/** What `stackOf` needs to draw one route's screen. */
export type ScreenView<Message> = Readonly<{
  /**
   * Shown over the others, as a modal or a sheet. Add `presentation(...)` or
   * `...sheet(...)` to `attributes` to say which.
   */
  isModal?: boolean
  attributes?: Attributes<Message>
  children: ReadonlyArray<Html>
}>

export type StackOfOptions<Route, Message> = Readonly<{
  /**
   * Names a route's screen. Two routes in one stack that can be open at the
   * same time need different keys, and one route keeps its key while open.
   * The route's place is added, so the same route may be open twice.
   */
  key: (route: Route) => string
  /** The phone closed `count` screens by itself: `popByPhone` in `update`. */
  onPoppedByPhone: (count: number) => Message
  screen: (route: Route, place: Place) => ScreenView<Message>
  /** Anything for the stack's own view: a `testID`. */
  attributes?: Attributes<Message>
}>

/** Draws a stack of routes as a native stack of keyed screens. */
export const stackOf = <Route, Message>(
  h: HtmlBuilder<Message>,
  routes: Routes<Route>,
  options: StackOfOptions<Route, Message>,
): Html =>
  stack(
    (options.attributes ?? []) as never,
    routes.map((route, index) => {
      const place: Place = { index, isRoot: index === 0, isTop: index === routes.length - 1 }
      const view = options.screen(route, place)
      return (view.isModal === true ? modalScreen : screen)(
        [
          h.Key(`${index}:${options.key(route)}`),
          // The first screen cannot be closed by the phone, so it has nothing to report.
          ...(place.isRoot ? [] : [onDismissed<Message>(options.onPoppedByPhone)]),
          ...(view.attributes ?? []),
        ] as never,
        view.children,
      )
    }),
  )
