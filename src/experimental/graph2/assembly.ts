// EXPERIMENTAL (Phase 3D.15). What a version 2 graph says, in the words of
// the validated models: the description stringBarBody.ts or stringBody.ts
// builds an instrument from. It is not a compiler: it makes no engine call
// and plays nothing. It exists so that a graph can be shown to describe
// exactly the mechanical assembly of a standalone reference, and it is what
// a compiler phase would start from.
//
// Two assemblies are recognised, and only those: a string on the body by
// its bridge, and a string tied to a bar that stands on the body on two
// pads. Any other valid graph is refused here with the reason.
import type { StringBarBody } from '../string/stringBarBody.ts'
import type { StringBody } from '../string/stringBody.ts'
import { BODY } from '../string/stringBody.ts'
import { COMPONENTS, portOf, type Graph, type PortRef } from './model.ts'
import { describeIssue, errorsOf, validate, type Policy } from './validate.ts'

export type Assembly =
  | { kind: 'stringOnBody'; spec: StringBody; ids: { string: string; body: string; pluck?: string; mute?: string } }
  | { kind: 'barBridge'; spec: StringBarBody; ids: { string: string; bar: string; body: string; pluck?: string; mute?: string; strike?: string; contacts: string[] } }

/** Hardness 0..1 is a Hertz contact stiffness of 1e6..1e10 N/m^1.5, as the builder's mallet has it. */
const contactStiffness = (hardness: number) => 10 ** (6 + 4 * hardness)

/** The mechanical assembly a graph describes. Throws, with every reason, if the graph is not valid or is not one of the two assemblies known. */
export function describeAssembly(graph: Graph, policy?: Policy): Assembly {
  const problems = errorsOf(validate(graph, policy))
  if (problems.length) throw new Error(`This instrument cannot be described:\n${problems.map((i) => `- ${describeIssue(i)}`).join('\n')}`)
  const of = (type: keyof typeof COMPONENTS) => graph.components.filter((c) => c.type === type)
  const [strings, bars, bodies] = [of('steelString'), of('metalBar'), of('dampedBox')]
  const kind = (k: string) => graph.connections.filter((c) => c.kind === k)
  const targets = (k: string) => graph.targets.filter((t) => t.kind === k)
  const along = (ref: PortRef) => portOf(graph, ref)!.at as number
  const unknown = (why: string) => new Error(`This instrument is valid, but it is not an assembly a validated model exists for: ${why}`)
  if (strings.length !== 1 || bodies.length !== 1 || graph.output?.component !== bodies[0]?.id) throw unknown('there must be one string and one body, and the body must be what is heard.')
  const [string, body] = [strings[0], bodies[0]]
  const [pluck, mute] = [targets('pluck')[0], targets('mute')[0]]
  if (targets('pluck').length > 1 || targets('mute').length > 1) throw unknown('the string is plucked at one place and muted at one place.')
  // The validated string is muted where it is plucked: one port serves both.
  if (pluck && mute && along(pluck.at) !== along(mute.at)) throw unknown('the string\'s finger rests where it plucks; a mute elsewhere has not been validated.')
  const pluckAt = pluck ? along(pluck.at) : mute ? along(mute.at) : 0.8
  const common = { tension: string.params.tension, length: string.params.length, pluckAt }

  if (bars.length === 0) {
    if (kind('bridge').length !== 1 || graph.connections.length !== 1) throw unknown('a string with no bar stands on the body by its bridge and by nothing else.')
    if (targets('strike').length || targets('contact').length) throw unknown('there is no bar to strike or to touch.')
    return { kind: 'stringOnBody', spec: { ...common, joined: true }, ids: { string: string.id, body: body.id, pluck: pluck?.id, mute: mute?.id } }
  }

  if (bars.length !== 1 || kind('tie').length !== 1 || kind('pad').length !== 2 || kind('bridge').length) throw unknown('with a bar, the string is tied to it once, the bar stands on two pads, and the string has no bridge of its own.')
  const bar = bars[0]
  const tie = kind('tie')[0]
  // The pads in the order they lie along the bar.
  const pads = kind('pad').sort((a, b) => along(a.from) - along(b.from))
  if (pads[0].stiffness !== pads[1].stiffness || pads[0].damping !== pads[1].damping) throw unknown('the two pads have the same stiffness and damping in the validated model.')
  if (targets('strike').length > 1) throw unknown('the bar is struck at one place.')
  const strike = targets('strike')[0]
  const contacts = targets('contact')
  const onBoard = (ref: PortRef): [number, number] => {
    const at = portOf(graph, ref)!.at
    return at === null ? [BODY.bridgeAt[0], BODY.bridgeAt[1]] : [(at as [number, number])[0], (at as [number, number])[1]]
  }
  const material = COMPONENTS.metalBar.materials![bar.material!]
  const spec: StringBarBody = {
    ...common,
    stringOn: true,
    bar: { density: material.density, youngsModulus: material.youngsModulus, lossFactor: material.lossFactor, length: bar.params.length, width: bar.params.width, thickness: bar.params.thickness, strikeAt: strike ? along(strike.at) : 0.5, supports: [along(pads[0].from), along(pads[1].from)] },
    barAt: [0.5, 0.65], // not used: the pads say where the bar stands
    mount: { stiffness: pads[0].stiffness!, damping: pads[0].damping! },
    ...(strike ? { mallet: { mass: strike.striker!.mass, stiffness: contactStiffness(strike.striker!.hardness) } } : {}),
    padsAt: [onBoard(pads[0].to), onBoard(pads[1].to)],
    stringOnBar: { at: along(tie.to), stiffness: tie.stiffness!, damping: tie.damping! },
    // The validated model's description has one place for a finger on the bar; further ones are listed in `ids.contacts` for a compiler to add as the hybrid lab does.
    ...(contacts.length ? { touchBar: { at: along(contacts[0].at) } } : {}),
  }
  return { kind: 'barBridge', spec, ids: { string: string.id, bar: bar.id, body: body.id, pluck: pluck?.id, mute: mute?.id, strike: strike?.id, contacts: contacts.map((t) => t.id) } }
}
