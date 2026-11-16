// EXPERIMENTAL (Phase 3D.15). The reference instruments as version 2
// graphs: the validated topologies and parameters of Phases 3C.2.3 and 3D.9
// to 3D.11, written down. No new tuning: every number here is one the
// standalone references already use (src/experimental/string/stringBarBody.ts,
// stringBody.ts). Each call returns a fresh graph.
import { BODY } from '../string/stringBody.ts'
import type { Graph } from './model.ts'

/** The approved A2 string: 73.5 N, 0.65 m. Plucked, and muted, at 0.8 of its length. */
const string = () => ({ id: 'c1', type: 'steelString' as const, name: 'String', params: { tension: 73.5, length: 0.65 }, ports: [{ id: 'pluck', name: 'Pluck point', at: 0.8 }] })

/**
 * The bar-as-bridge hybrid (Phase 3D.11's `dampable(0.5, tieAt)`): the string's end tied to an aluminium
 * bar, which stands on two pads on the approved body. The first pad is on the body's bridge point; the
 * second lies along the board's length from it, as far as the pads are apart on the bar.
 */
export function hybridFixture(tieAt: 0.2 | 0.18 = 0.2): Graph {
  const length = 0.1994
  const pads = [0.215, 0.785]
  return {
    version: 2,
    meta: { name: `String on a bar bridge, tied at ${tieAt.toFixed(2)}`, notes: 'Reference hybrid of Phases 3D.9 to 3D.11. Experimental: not approved by listening.' },
    nextId: 11,
    components: [
      string(),
      {
        id: 'c2',
        type: 'metalBar',
        name: 'Metal bar',
        material: 'aluminium',
        params: { length, width: 20, thickness: 5 },
        ports: [
          { id: 'pad-a', name: 'First pad', at: pads[0] },
          { id: 'pad-b', name: 'Second pad', at: pads[1] },
          { id: 'tie', name: 'String tie', at: tieAt },
          { id: 'middle', name: 'Middle', at: 0.5 },
        ],
      },
      { id: 'c3', type: 'dampedBox', name: 'Damped box body', params: {}, ports: [{ id: 'pad-b', name: 'Second pad', at: [BODY.bridgeAt[0] + (Math.abs(pads[1] - pads[0]) * length) / BODY.plate.length, BODY.bridgeAt[1]] }] },
    ],
    connections: [
      { id: 'c4', kind: 'tie', from: { component: 'c1', port: 'end' }, to: { component: 'c2', port: 'tie' }, stiffness: 1e6, damping: 0 },
      { id: 'c5', kind: 'pad', from: { component: 'c2', port: 'pad-a' }, to: { component: 'c3', port: 'bridge' }, stiffness: 1e6, damping: 5 },
      { id: 'c6', kind: 'pad', from: { component: 'c2', port: 'pad-b' }, to: { component: 'c3', port: 'pad-b' }, stiffness: 1e6, damping: 5 },
    ],
    targets: [
      { id: 'c7', kind: 'pluck', name: 'Pluck', at: { component: 'c1', port: 'pluck' } },
      { id: 'c8', kind: 'mute', name: 'Mute string', at: { component: 'c1', port: 'pluck' } },
      { id: 'c9', kind: 'strike', name: 'Strike', at: { component: 'c2', port: 'middle' }, striker: { mass: 0.005, hardness: 0.5 } },
      { id: 'c10', kind: 'contact', name: 'Damp bar', at: { component: 'c2', port: 'middle' } },
    ],
    output: { kind: 'bodyRadiation', component: 'c3', distance: 1 },
  }
}

/** The approved string instrument, for comparison: the same string standing on the same body by its bridge. */
export function stringOnBodyFixture(): Graph {
  return {
    version: 2,
    meta: { name: 'String on its body', notes: 'The approved string instrument of Phase 3C.2.3, for comparison.' },
    nextId: 6,
    components: [string(), { id: 'c2', type: 'dampedBox', name: 'Damped box body', params: {}, ports: [] }],
    connections: [{ id: 'c3', kind: 'bridge', from: { component: 'c1', port: 'end' }, to: { component: 'c2', port: 'bridge' } }],
    targets: [
      { id: 'c4', kind: 'pluck', name: 'Pluck', at: { component: 'c1', port: 'pluck' } },
      { id: 'c5', kind: 'mute', name: 'Mute string', at: { component: 'c1', port: 'pluck' } },
    ],
    output: { kind: 'bodyRadiation', component: 'c2', distance: 1 },
  }
}
