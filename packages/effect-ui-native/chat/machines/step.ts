/**
 * One step of a machine, worked out with no actor running.
 *
 * effect-machine 0.32.1 has no function that takes a state and an event and
 * hands back the next state at once. What it has in the open is
 * `Machine.replay`: start from a given state, feed a list of events, answer
 * with the state at the end, as an Effect. Our rules are plain functions, so
 * that Effect finishes at once and `Effect.runSync` can read it.
 *
 * `Machine.definition` lists which state has a rule for which event. That is
 * how `handles` knows an event will be ignored before it is tried.
 *
 * This file is those two calls, and nothing else. The rules stay in the
 * machine's own definition.
 */
import { Effect } from 'effect'
import { Machine, type MachineType } from 'effect-machine'

type Tagged = { readonly _tag: string }

export type Stepper<S extends Tagged, E extends Tagged> = Readonly<{
  /** The next state. The state it was given when the machine has no rule for this event in this state. */
  step: (state: S, event: E) => S
  /** Whether the machine has a rule for this event in this state. */
  handles: (state: S, event: E) => boolean
  /** Every pair the machine has a rule for, as `State/Event`. */
  rules: ReadonlyArray<string>
}>

export const stepper = <S extends Tagged, E extends Tagged>(
  machine: MachineType<S, E, never, any, any, void, any>,
): Stepper<S, E> => {
  const rules = Machine.definition(machine).states.flatMap(state =>
    state.transitions.map(transition => `${state.tag}/${transition.event}`),
  )
  const known = new Set(rules)
  const handles = (state: S, event: E): boolean => known.has(`${state._tag}/${event._tag}`)
  return {
    rules,
    handles,
    step: (state, event) =>
      handles(state, event) ? Effect.runSync(Machine.replay(machine, [event], { from: state })) : state,
  }
}
