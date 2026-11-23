/**
 * The showcase shell: shows the menu, opens one demo at a time, and comes
 * back to the menu when the demo exits or crashes.
 *
 * Each demo is its own Foldkit program. Only one runs at a time, so a broken
 * demo cannot take the others down with it.
 */
import { Runtime } from 'foldkit'

import type { Device } from '../../src/index'
import { type MenuEntry, makeMenu } from './menu'

export type DemoEnv = Readonly<{
  device: Device
  /** Leave the demo and go back to the menu. */
  exit: () => void
  /** Tell the shell the demo crashed. It goes back to the menu and shows why. */
  crashed: (error: Error) => void
}>

export type Running = Readonly<{ dispose: () => void }>

export type Demo = MenuEntry &
  Readonly<{
    /**
     * Starts the demo in `container` and returns how to stop it. Usually
     * `(container, env) => Runtime.embed(makeDemo(container, env))`. Each demo
     * has its own Model and Message types, so the shell never sees its program.
     */
    start: (container: HTMLElement, env: DemoEnv) => Running
  }>

export const startShowcase = (
  container: HTMLElement,
  device: Device,
  demos: ReadonlyArray<Demo>,
): Running => {
  let running: Running | undefined
  let isStopped = false

  // A program asks to be replaced from inside one of its own Commands. It is
  // swapped after that Command has finished, not in the middle of it.
  const later = (job: () => void): void => {
    void Promise.resolve().then(() => {
      if (!isStopped) job()
    })
  }

  const replaceWith = (start: () => Running): void => {
    running?.dispose()
    running = undefined
    running = start()
  }

  const showMenu = (lastError?: string): void =>
    replaceWith(() =>
      Runtime.embed(
        makeMenu(container, {
          device,
          entries: demos,
          open: id => later(() => openDemo(id)),
          ...(lastError === undefined ? {} : { lastError }),
        }),
      ),
    )

  const openDemo = (id: string): void => {
    const demo = demos.find(each => each.id === id)
    if (demo === undefined) return
    try {
      replaceWith(() =>
        demo.start(container, {
          device,
          exit: () => later(() => showMenu()),
          crashed: error => later(() => showMenu(`${demo.title}: ${error.message}`)),
        }),
      )
    } catch (error) {
      showMenu(`${demo.title}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  showMenu()

  return {
    dispose: () => {
      isStopped = true
      running?.dispose()
      running = undefined
    },
  }
}
