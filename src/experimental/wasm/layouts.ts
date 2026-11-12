// EXPERIMENTAL (Phase 3A.1). Not used by the application.
// The systems used by the test page, the benchmarks and the listening
// renders, described once as data so that the WebAssembly engine and the
// TypeScript reference are given exactly the same thing.
import { ALUMINIUM_BAR, barModes, type BarGeometry } from '../physics/bar.ts'
import { HertzContact, SpringDamper } from '../physics/connections.ts'
import { ModalResonator, pointMass, type Mode } from '../physics/resonator.ts'
import { System } from '../physics/system.ts'
import { Design, type Call, type Port } from './engine.ts'

export interface Layout {
  name: string
  resonators: Mode[][]
  springs: { a: Port; b: Port; stiffness: number; damping: number }[]
  /** Free masses that can be thrown at a port through a Hertz contact. */
  mallets: { target: Port; mass: number; stiffness: number }[]
  outputs: { port: Port; gain: number }[]
  /** Where a note is struck, one per playable resonator. */
  strikePorts: Port[]
}

/** Every bar has two ports: 0 where it is joined to others, 1 where it is struck and heard. */
const bar = (geometry: BarGeometry, join: number, sampleRate: number) => barModes(geometry, [join, 0.35], sampleRate)

const SOFT = { mass: 0.02, stiffness: 1e7 } // N / m^1.5
const HARD = { mass: 0.02, stiffness: 1e9 }

export const LAYOUTS = {
  /** One aluminium bar with a soft and a hard mallet. */
  oneBar: (sampleRate: number): Layout => ({
    name: 'One metal bar',
    resonators: [bar(ALUMINIUM_BAR, 0.1, sampleRate)],
    springs: [],
    mallets: [
      { target: [0, 1], ...SOFT },
      { target: [0, 1], ...HARD },
    ],
    outputs: [{ port: [0, 1], gain: 1 }],
    strikePorts: [[0, 1]],
  }),

  /** Two bars of different length joined by a spring and damper. */
  twoBars: (sampleRate: number): Layout => ({
    name: 'Two coupled bars',
    resonators: [bar(ALUMINIUM_BAR, 0.1, sampleRate), bar({ ...ALUMINIUM_BAR, length: 0.32 }, 0.3, sampleRate)],
    springs: [{ a: [0, 0], b: [1, 0], stiffness: 4e5, damping: 1 }],
    mallets: [
      { target: [0, 1], ...SOFT },
      { target: [0, 1], ...HARD },
    ],
    outputs: [
      { port: [0, 1], gain: 0.7 },
      { port: [1, 1], gain: 0.7 },
    ],
    strikePorts: [
      [0, 1],
      [1, 1],
    ],
  }),

  /** Three bars in a chain: A-B and B-C. The second spring can be removed and restored while sounding. */
  threeBars: (sampleRate: number): Layout => ({
    name: 'Three coupled bars',
    resonators: [
      bar(ALUMINIUM_BAR, 0.1, sampleRate),
      bar({ ...ALUMINIUM_BAR, length: 0.32 }, 0.3, sampleRate),
      bar({ ...ALUMINIUM_BAR, length: 0.27, thickness: 8 }, 0.2, sampleRate),
    ],
    springs: [
      { a: [0, 0], b: [1, 0], stiffness: 4e5, damping: 1 },
      { a: [1, 1], b: [2, 0], stiffness: 2e5, damping: 0.5 },
    ],
    mallets: [
      { target: [0, 1], ...SOFT },
      { target: [0, 1], ...HARD },
    ],
    outputs: [
      { port: [0, 1], gain: 0.6 },
      { port: [1, 1], gain: 0.6 },
      { port: [2, 1], gain: 0.6 },
    ],
    strikePorts: [
      [0, 1],
      [1, 1],
      [2, 1],
    ],
  }),

  /** The approved metal bar instrument's 25 bars, a quarter-tone apart, unconnected: 200 modes. */
  keyboard: (sampleRate: number): Layout => {
    const keys = Array.from({ length: 25 }, (_, key) => barModes(ALUMINIUM_BAR, [0.35], sampleRate, key))
    return {
      name: '25 independent bars',
      resonators: keys,
      springs: [],
      mallets: [],
      outputs: keys.map((_, r) => ({ port: [r, 0] as Port, gain: 0.5 })),
      strikePorts: keys.map((_, r) => [r, 0] as Port),
    }
  },

  /** One resonator with many modes (benchmarks only). */
  manyModes: (count: number) => (): Layout => ({
    name: `One resonator, ${count} modes`,
    resonators: [Array.from({ length: count }, (_, n) => ({ frequency: 100 + (17000 * n) / count, t60: 2, mass: 0.3, shape: [1] }))],
    springs: [],
    mallets: [],
    outputs: [{ port: [0, 0], gain: 1 }],
    strikePorts: [[0, 0]],
  }),
}

/** The engine calls that build a layout, with the connection indices needed to edit it later. */
export function toCalls(layout: Layout, sampleRate: number, corrected = true) {
  const design = new Design(sampleRate, corrected)
  for (const modes of layout.resonators) design.modal(modes)
  const springs = layout.springs.map((s) => design.spring(s.a, s.b, s.stiffness, s.damping))
  // A mallet starts a metre away, at rest: it touches nothing until launched.
  const mallets = layout.mallets.map((m) => design.contact([design.mass(m.mass), 0], m.target, m.stiffness, 1.5, -1))
  for (const o of layout.outputs) design.output(o.port, o.gain)
  return { calls: design.build(), springs, mallets }
}

/** Calls that retune every mode of one resonator: frequencies x `ratio`, decay times x `decay`. */
export const tuneCalls = (layout: Layout, r: number, ratio: number, decay = 1): Call[] =>
  layout.resonators[r].map((mode, n) => ['tune', r, n, mode.frequency * ratio, mode.t60 * decay])

/**
 * The same layout in the TypeScript reference engine. Its process() reads one
 * port only, so the output is the first output port rather than the mix.
 */
export function toSystem(layout: Layout, sampleRate: number) {
  const system = new System()
  for (const modes of layout.resonators) system.add(new ModalResonator(modes, sampleRate))
  const ref = ([resonator, port]: Port) => ({ resonator, port })
  const springs = layout.springs.map((s) => {
    const spring = new SpringDamper(s.stiffness, s.damping)
    system.connect(spring, ref(s.a), ref(s.b))
    return spring
  })
  const mallets = layout.mallets.map((m) => {
    const mass = pointMass(m.mass, sampleRate)
    system.connect(new HertzContact(m.stiffness), { resonator: system.add(mass), port: 0 }, ref(m.target), -1)
    return mass
  })
  system.build(sampleRate)
  return { system, springs, mallets, output: ref(layout.outputs[0].port), strikePorts: layout.strikePorts.map(ref) }
}
