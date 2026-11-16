# The version 2 instrument graph: foundation (Phase 3D.15)

Phase 3D.14 showed that an instrument graph with named ports can describe
the hybrid instrument and reproduce its reference exactly. This phase
turns that sketch into a data model that can be relied on: types, a
four-tier validator, a canonical text form, a reader for both format
versions, and the reference instruments as fixtures.

**It is isolated pure code.** Nothing uses it: not the builder, not the
application, not the Hybrid Lab, not any page. `src/builder`, the engine,
the engine's AudioWorklet processor, the approved instruments and every
sound are unchanged, and the production build is byte-for-byte what it
was. No dependency was added.

No hybrid sound has been listened to; nothing here depends on or claims
listening approval.

| file | what it is |
|---|---|
| `src/experimental/graph2/model.ts` | the types, the tables of what exists and what may join what, small look-ups |
| `src/experimental/graph2/validate.ts` | four tiers of checking; the budget and the policy; the estimate |
| `src/experimental/graph2/io.ts` | canonical text; the reader of version 1 and version 2 |
| `src/experimental/graph2/fixtures.ts` | the three reference instruments |
| `src/experimental/graph2/assembly.ts` | what a graph says in the validated models' own terms (not a compiler) |
| `tests/graph-v2.test.ts` | 73 tests |
| `tests/fixtures/graph-v2/*.json` | the three references as saved files |

## 1. What changed from the proof of concept

The Phase 3D.14 sketch (`src/experimental/hybrid/assembly.ts`) was not
taken as it stood. Five things are different, each for a reason.

| the sketch | the foundation | why |
|---|---|---|
| a strike and a finger contact were connections | they are **targets** | they are ways of playing, not parts of the instrument (section 4) |
| the mallet was a component | the striker is a property of a strike target | it is a tool, held by the player; a component that is not part of the instrument was a second representation of nothing mechanical |
| the string's pluck point was a parameter | it is a port, and plucking is a target at it | so that every target, on a string or a bar, references a port in the same way |
| ports were a name → place map | ports are objects with a stable `id`, a `name` and a place | a port can be renamed or moved without any reference to it changing |
| issues had a tier | issues have a tier, a severity, a code, and what they concern | warnings and errors are different things, and a message must point at something |

The sketch and its nine tests are left in place as the record of Phase
3D.14. A compiler phase should remove them: `graph2/assembly.ts` covers
what they showed.

## 2. Overview

```ts
interface Graph {
  version: 2
  meta: { name: string; notes?: string }   // about the document; nothing physical
  nextId: number                           // so that no identifier is ever reused
  components: Component[]                  // what vibrates
  connections: Connection[]                // what holds the components together
  targets: Target[]                        // where it can be played
  output: AcousticOutput | null            // what is heard
}
```

Three layers, kept apart:

| layer | holds | saved |
|---|---|---|
| **topology** | components, their ports, the mechanical connections between ports, physical parameters, the acoustic output | yes |
| **targets** | the places where a player may pluck, strike or lay a finger, and what a striker is | yes, as configuration |
| **playing** | a pluck, a stroke, a finger going down or coming up (`GestureEvent`) | **never** |

The hybrid's physical topology:

```
   pluck, mute                        strike, finger
   (targets)                            (targets)
       |                                    |
       v                                    v
  ============ string ============o   .-----o-----------.
  nut                         end |   |    metal bar    |
                                  '-->o tie             |
                              tie     '--o-----------o--'
                          (spring,       | pad       | pad
                           damper)       | (spring,  | (spring,
                                         |  damper)  |  damper)
                               .---------o-----------o---------.
                               |  bridge                       |
                               |  point       soundboard       |
                               |             ............      |
                               |             enclosed air      |
                               '------------- body ------------'
                                               |
                                               v
                                   radiated sound pressure
                                   (the only thing heard)
```

Every arrow between components is a mechanical connection that pushes
both ways. There is no audio connection anywhere: the string and the bar
are heard only through what they do to the body.

## 3. Components and ports

| type | what it is | parameters (unit, range) | fixed ports | placed ports |
|---|---|---|---|---|
| `steelString` | the modal string, 3.6 g/m | `tension` (N, 30–120), `length` (m, 0.5–0.8) | `end`: its bridge end | along its length, 0 (nut) to 1 (bridge end) |
| `metalBar` | a bar, free to bend and to move as a whole | `length` (m, 0.05–1.5), `width` (mm, 10–200), `thickness` (mm, 2–40); `material`: aluminium, steel, brass, bronze | none | along its length, 0 to 1 |
| `dampedBox` | the approved body: spruce soundboard and enclosed air with its screened hole | none | `bridge`: the approved bridge point | on the soundboard: [along, across], 0 to 1 each |

Ranges and units are the present builder's own, taken by reference from
its table, so the two cannot drift apart.

**Soundboard and air are one component.** The brief lists them
separately; the validated model has them as one assembly whose plate,
cavity and hole are fixed and whose coupling is not the user's to change.
Two components would need a connection between them that nothing
validated allows anyone to alter, and would be a second representation of
one object.

**A support pad is a connection**, not a component: in the validated model
it has no motion of its own, only a stiffness and a damping between two
points.

**Ports.**

```ts
interface Port { id: string; name: string; at: number | [number, number] }
interface PortRef { component: string; port: string }
```

- A **fixed** port exists on every component of a type and has a reserved
  identifier (`end`, `bridge`). It is not stored on the component.
- A **placed** port is one the user has put somewhere. Its `id` is unique
  within its component and never changes; its `name` is for people; its
  `at` is where it is.
- A place is **normalised**: a fraction of a bar's or string's length, or
  two fractions of the soundboard. Metres follow from the component's own
  dimensions (`placeInMetres`), so a port keeps its meaning when the
  component is resized: "a fifth of the way along" stays a fifth.
- All ports move along **one axis**, perpendicular to the soundboard
  (`axis: 'normal'` on every component type). The model has no other
  direction, so any two ports are dimensionally compatible; *which* may be
  joined is decided by connection kind, below.
- A component takes any number of connections and targets, at different
  ports or at the same one. In the hybrid the bar has four ports and five
  things attached.
- **No identifier is an engine index.** Components, connections and
  targets share one namespace of identifiers (`c1`, `c2`, …) given out by
  `nextId` and never reused; ports are named within their component.
  Which engine resonator, port row or connection each becomes is the
  compiler's business and is never written down.

Port identities are stable under everything unrelated: changing a
parameter, moving or renaming a port, reordering lists. A test changes all
of those at once and checks that every connection and target is untouched.

## 4. Connections: parts of the instrument

```ts
interface Connection { id; kind: 'bridge' | 'tie' | 'pad'; from: PortRef; to: PortRef; stiffness?; damping? }
```

| kind | from → to | what it is | parameters it owns |
|---|---|---|---|
| `bridge` | a string's `end` → a body's `bridge` | the approved bridge | none: its stiffness is the approved one, and setting one is refused |
| `tie` | a string's `end` → a placed port of a bar | a spring, and a damper beside it | `stiffness` (N/m, 10⁴–10⁸), `damping` (N s/m, 0–100); both required, damping may be 0 |
| `pad` | a placed port of a bar → any port of a body | a spring and a damper side by side | `stiffness` (N/m, 10⁴–10⁸), `damping` (N s/m, 0–100); both required |

- Stiffness and damping belong to the **connection**, never to either
  component.
- A connection has its own stable identifier.
- **There is no general connection.** A kind that is not one of the three
  is refused with "There is no general connection between ports". A string
  cannot be tied to the board (that is a bridge), a pad cannot join two
  bars, nothing joins two ports of one component.
- A string's end is one point and is held by **one** thing: a bridge and a
  tie together are a conflict, and so are two of either.
- The same two ports cannot be connected twice.

**Compliant or rigid?** A tie is always compliant: a spring of stated
stiffness. A rigid tie is not offered, because the validated model has
none (its tie is the bridge's 10⁶ N/m spring) and an infinitely stiff
joint is a different numerical object. The upper limit, 10⁸ N/m, is a
hundred times the validated value.

## 5. Targets and gestures: playing is not topology

A pluck, a stroke and a finger apply forces only while they happen. They
are not parts of the instrument, so they are not connections. What *is*
persistent is **where** such a thing may be done.

```ts
interface Target { id; kind: 'pluck' | 'mute' | 'strike' | 'contact'; name; at: PortRef; striker?: { mass; hardness } }
```

| kind | at | what it is | held |
|---|---|---|---|
| `pluck` | a placed port of a string | where a finger plucks | no |
| `mute` | a placed port of a string | where a finger can rest to damp the string | yes |
| `strike` | a placed port of a bar | where a striker lands; `striker` is its mass (kg, 0.002–0.5) and hardness (0–1) | no |
| `contact` | a placed port of a bar | where a finger can rest to damp the bar | yes |

- A target names a **port**, by reference. It adds nothing mechanical to
  the graph; several targets may share a port (in the hybrid the bar's
  middle is both struck and damped).
- The striker's mass and hardness are saved with the strike target: they
  describe a tool, and are configuration, not state.
- How hard a finger presses, how hard a pluck is and how fast a stroke
  arrives are **not** saved. They belong to the gesture.

**Gestures** are not part of a graph at all:

```ts
type GestureEvent =
  | { target; action: 'pluck'; force }                 // N
  | { target; action: 'strike'; speed }                // m/s
  | { target; action: 'touch'; stiffness?; damping? }  // a finger goes down
  | { target; action: 'release' }                      // and comes up
```

Each addresses one target by identifier. Two fingers are two targets, so
two `touch` events on different targets are independent by construction:
neither names the other, and nothing in the model has room for only one.
`cannotPlay(graph, event)` says whether a gesture makes sense on a graph
(the target exists, the action suits its kind, the strength is a positive
number); it reads the graph and changes nothing.

**No state of playing can be saved.** The writer copies only the fields a
saved instrument has, so anything else on the objects is not written. The
reader refuses a file with any field it does not know, naming it
(`targets[c10].down`). A graph has no place to say that a finger is down.

"Release" is an action on a held target, not a target of its own.

## 6. Validation

```ts
interface Issue { tier; severity: 'error' | 'warning'; code; message; component?; port?; connection?; target? }
validate(graph, policy?) : Issue[]
```

Four tiers, four questions. Each is a function of its own
(`checkStructure`, `checkPhysics`, `checkNumerics`, `checkBudget`) and can
be called alone. An **error** means the graph must not be compiled; a
**warning** means it may be, and the user should be told. Every issue
carries a fixed `code` and names what it concerns.

`validate` runs structure and numerics always. Physics and budget follow
references and measure distances, so they run only when the first two
have no errors; until then their silence means "not looked at".

### A. Structure: is it a graph?

All errors.

| code | rule |
|---|---|
| `version`, `meta`, `next-id`, `missing-list`, `not-a-graph` | the top level is what it should be |
| `bad-identifier`, `duplicate-identifier` | identifiers are names, and each is used once across components, connections and targets |
| `next-id-behind` | the counter is ahead of every identifier in use |
| `unknown-component-type`, `unknown-connection-kind`, `unknown-target-kind` | an unknown kind is refused, never dropped |
| `missing-parameter`, `unknown-parameter`, `unexpected-parameter`, `material` | a component or connection has exactly the parameters its kind has |
| `duplicate-port`, `reserved-port`, `port-place` | ports are unique within a component, do not reuse a fixed name, and are placed with one number on a line or two on a surface |
| `missing-component`, `missing-port`, `bad-reference` | every reference resolves |
| `incompatible-end`, `self-connection` | a connection joins only what its kind may join |
| `duplicate-connection`, `string-end-held-twice` | no duplicate or conflicting constraint |
| `incompatible-target`, `striker` | a target is on the right kind of component, at a placed port; a strike has a striker and nothing else does |
| `output`, `output-missing-component`, `output-not-a-body` | the acoustic output names a body that exists |

### B. Physics: could it exist, and is it likely to be an instrument?

| code | severity | rule |
|---|---|---|
| `bar-unsupported` | error | a bar with a string tied to it stands on nothing |
| `bar-needs-two-pads` | error | on one pad it would spin about it |
| `bar-too-many-pads` | error | more than two: the validated model has no meaning for it |
| `pads-share-a-point`, `pads-on-two-bodies` | error | the two pads are under one point, on one point, or on different bodies |
| `pads-would-stretch-bar` | error | the pads are not as far apart on the board as on the bar (2 mm tolerance) |
| `tie-far-from-node` | warning | the string is tied more than 0.075 of the bar from where its note is still: found to cost the string its fundamental (Phase 3D.10) |
| `pad-far-from-node` | warning | a pad more than 0.1 from a node damps the bar's note (Phase 3D.6) |
| `contact-on-node` | warning | a finger on the note's node hardly damps it (Phase 3D.11) |
| `strike-on-node` | warning | struck on a node the bar sounds its knock more than its note (Phase 3D.10) |
| `bar-overhangs-board` | warning | a bar end is more than a tenth of its length beyond the board |
| `unusual-mass` | warning | a bar lighter than 5 g or heavier than 2 kg |
| `unconnected` | warning | a bar attached to nothing |
| `string-end-free` | warning | a string held by nothing |
| `radiator-disconnected` | warning | nothing is connected to the body that is heard |
| `nothing-to-play`, `no-output` | warning | no place to pluck or strike; nothing heard |

The warnings are the point of this tier. A bar on pads at its ends, a tie
at a tenth of the bar, a bar of brass or of another length are all valid
instruments, and several were found in earlier phases to behave badly or
differently. The validator says what was found and lets them through. It
does not judge an instrument by its resemblance to the reference.

### C. Numerics: are the numbers ones the solver has a meaning for?

All errors.

| code | rule |
|---|---|
| `not-a-number` | a parameter, a place or a striker value is not a finite number |
| `out-of-range` | outside the stated range (which excludes zero or negative values wherever they have no meaning: a stiffness, a length, a mass) |
| `port-off-component` | a place outside 0 to 1 |
| `bar-above-playable` | a bar whose lowest note is above 0.45 of the sample rate |
| `unsupported-distance` | a listening distance other than 1 m, the only one the radiation model is validated at |

The message gives the value, the range and the unit: "Connection c5
(support pad): Stiffness must be between 10000 and 100000000 N/m (it is
100)."

### D. Budget: is it within what has been run in real time?

Two different things are kept apart by name:

| | value | what it is |
|---|---|---|
| `ENGINE_CAPACITY` | 128 resonators, 32 solver connections, 16 384 modes | a fact about the engine |
| `INITIAL_BUDGET` | 1 string, 1 bar, 1 body, 12 solver connections, 4 finger contacts, 200 modes | Phase 3D.14's conservative budget: what has been run, with a step of margin |

Both live in a `Policy`, passed to `validate`, together with the sample
rate the estimate is made for and whether a graph over the budget is an
error (the initial policy) or a warning. Nothing else in the code has
these numbers. Over the engine's capacity is an error under any policy.

`estimate(graph, sampleRate)` counts what a graph would ask of the engine
from the graph alone. A test holds it equal to what the validated models
actually build for the reference instruments at 44.1, 48 and 96 kHz
(hybrid: 6 resonators, 189 modes, 9 connections; string on its body: 4,
178, 4).

**The budget is not a claim of real-time safety.** It records what has
been tried on one machine. Its message says so: "That is what has been run
in real time so far, not the engine's limit."

## 7. Canonical text

`serialize(graph)` writes the **canonical form**:

- one fixed order of fields in every object;
- components, connections and targets in identifier order (by their
  letters, then their number: `c2` before `c10`); ports in identifier
  order within their component; parameters in key order;
- only the fields a saved instrument has;
- two-space indentation, `\n` line endings, a final newline;
- numbers exactly as JavaScript writes them, which is the shortest text
  that reads back as the same number. Nothing is rounded: a length of
  0.30000000000000004 is written as that. Minus zero is written as 0;
- a number that is not finite is **refused by name**
  ("c5.stiffness is NaN"), never written as something else.

**The order of components, connections, targets and ports in a file has no
meaning.** Identity is the identifier. Two graphs that are the same
instrument listed differently serialize to the same text
(`sameInstrument`). A test shuffles every list and every parameter object
25 times per reference and requires identical text.

Round trip: `readInstrument(serialize(g)).graph` equals `canonical(g)`,
and serializing that gives the same text again. A generated-case test
does this for 200 randomly varied hybrids (string, bar, material, pads,
tie, striker), and breaks each one in a random way to check it is then
refused with a reason that names a component, connection, target or
port. The generator is a ten-line seeded function, so the cases are the
same on every run; no dependency was added.

## 8. Reading either version

```ts
readInstrument(text, policy?) :
  | { version: 1; graph: /* the builder's own Graph */ }
  | { version: 2; graph: Graph; warnings: Issue[] }
```

| the file says | what happens |
|---|---|
| `"version": 1` | handed to the builder's own `deserialize`, called as it is. What comes back is exactly what the builder reads. It is **not** converted, renamed or reordered |
| `"version": 2` | refused if it has any unknown field; validated in all four tiers; refused with every error, each with its tier; otherwise returned in canonical form with its warnings |
| a number above 2 | "saved by a newer version of SonicMatter (format 3; this one reads formats 1 and 2). It has not been changed." |
| anything else, or nothing | "its format version is …" |
| not JSON, or not an object | said so; nothing is half-read |

The builder's own loading path is untouched and does not call this.

**Version 1 compatibility, tested.** Each of the seven examples the
builder ships is written by the builder, read through `readInstrument`,
and compared: the graph equals what the builder's loader returns and what
was written; writing it again gives the same text; and `translate` gives
the same engine calls. A broken version 1 file is refused in the version
1 loader's own words. The builder, for its part, still refuses a version
2 file by name, so neither format can be mistaken for the other.

## 9. The reference instruments

`fixtures.ts`, and the same three as files in `tests/fixtures/graph-v2/`:

| fixture | components | connections | targets |
|---|---|---|---|
| `hybridFixture(0.2)` | string, metal bar, body | tie, pad, pad | pluck, mute, strike, contact |
| `hybridFixture(0.18)` | the same, tied at 0.18 | | |
| `stringOnBodyFixture()` | string, body | bridge | pluck, mute |

Every number is one the standalone references already use: the A2 string
(73.5 N, 0.65 m, plucked at 0.8); the aluminium bar 0.1994 m × 20 mm ×
5 mm with pads at 0.215 and 0.785; the tie at 10⁶ N/m with no damper; pads
of 10⁶ N/m and 5 N s/m; the 5 g striker of hardness 0.5; the first pad on
the approved bridge point and the second along the board from it. No new
tuning.

**Parity.** `describeAssembly(graph)` states what a graph says in the
validated models' own terms. For the fixtures:

- the hybrid's description **equals** `dampable(0.5, tie)`, the Phase
  3D.11 reference, for both ties;
- the string's equals the approved string-on-body description;
- built from those descriptions by the validated models, unchanged, the
  engine calls are deeply equal to the references', and a pluck and a
  stroke through the processor give the same samples.

`describeAssembly` is not a compiler: it makes no engine call. It
recognises the two assemblies and refuses any other valid graph with the
reason ("valid, but it is not an assembly a validated model exists for").
The engine and the AudioWorklet were not touched.

## 10. An example

The approved string on its body, as saved (`string-on-body.json`):

```json
{
  "version": 2,
  "meta": {
    "name": "String on its body",
    "notes": "The approved string instrument of Phase 3C.2.3, for comparison."
  },
  "nextId": 6,
  "components": [
    {
      "id": "c1",
      "type": "steelString",
      "name": "String",
      "params": { "length": 0.65, "tension": 73.5 },
      "ports": [{ "id": "pluck", "name": "Pluck point", "at": 0.8 }]
    },
    { "id": "c2", "type": "dampedBox", "name": "Damped box body", "params": {}, "ports": [] }
  ],
  "connections": [
    { "id": "c3", "kind": "bridge", "from": { "component": "c1", "port": "end" }, "to": { "component": "c2", "port": "bridge" } }
  ],
  "targets": [
    { "id": "c4", "kind": "pluck", "name": "Pluck", "at": { "component": "c1", "port": "pluck" } },
    { "id": "c5", "kind": "mute", "name": "Mute string", "at": { "component": "c1", "port": "pluck" } }
  ],
  "output": { "kind": "bodyRadiation", "component": "c2", "distance": 1 }
}
```

(Shown with short objects on one line; the file itself has one field per
line.) The hybrid adds the bar with its four ports, a tie and two pads in
place of the bridge, one port on the body, and two more targets.

## 11. Known limitations

- **Three component types.** Wooden bars, the mallet-as-component and the
  listener of version 1 have no version 2 form yet. Version 1 instruments
  are read as version 1 and are not converted.
- **The body has no parameters.** Its plate, cavity and hole are the
  approved ones.
- **A bar's own damping multiplier** (a version 1 parameter) is not in
  version 2: the validated hybrid has none.
- **Two assemblies are recognised** by `describeAssembly`. The data model
  admits more (a bar of another metal, a mute elsewhere on the string, a
  bar attached to nothing); they validate, and are refused there.
- **One finger place on the bar** in the validated model's description;
  further `contact` targets are valid and are listed for a compiler to add
  as the Hybrid Lab does.
- **Pads of one bar must match** in the validated model; the graph can
  hold different ones, and `describeAssembly` refuses them.
- **Some physics cannot be judged from the graph.** Whether a bar sits on
  a harmonic of the string, and so absorbs it (Phase 3D.10), depends on
  its note *as it stands on its pads*, which only a simulation gives. No
  warning is attempted.
- **The warnings' thresholds** (0.075, 0.1 of a bar's length and so on)
  come from the earlier phases' measurements on one bar and are
  judgements, not laws.
- **The estimate** is checked against the validated models for the
  references only.
- **`layout`** (where a component is drawn) is carried and saved but
  nothing uses it.
- **No editing functions** (add, connect, move a port) and no undo
  history: this phase is the data and its rules, not an editor.
- **No conversion from version 1.** Deliberately.

## 12. What a compiler phase needs

1. Take `describeAssembly`'s output and call the validated builders, as
   the parity test already does by hand; return the map from graph
   identifiers (`ids`) to engine indices.
2. Add further bar contacts and further string pluck ports the way
   `buildLab` does, driven by the graph's targets rather than a fixed
   list.
3. Map `GestureEvent`s on targets to engine calls (pluck, launch, touch
   and release per finger).
4. Keep, permanently, the two parity assertions: engine calls deeply
   equal to the standalone reference, and samples equal.
5. Hold `estimate` against the compiler's real counts for every graph it
   accepts, not only the references.
6. Decide the output's level (full scale and make-up), which Phase 3D.14
   left open and which this schema deliberately does not store.
7. Remove the Phase 3D.14 sketch.

Independent of that, and still not done: several fingers in the engine's
processor (Phase 3D.14, section 8).

## 13. Regression

- The four reference WAV hashes are unchanged.
- **Not modified:** `src/builder/**`, `assembly/engine.ts`,
  `src/experimental/wasm/**`, `src/audio/**`, `src/App.tsx`,
  `src/experimental/string/**`, `src/experimental/hybrid/**` (the Hybrid
  Lab and the Phase 3D.14 sketch), every page, `package.json`,
  `vite.config.ts`.
- **New only:** the five files of `src/experimental/graph2/`, one test
  file, three fixture files, this document; README, ROADMAP and TESTING
  gain a few lines.
- The new code imports from the builder (its parameter table and its
  loader) and from the validated models. Nothing imports the new code.
- The production build is byte-for-byte identical with and without this
  phase's files.
- The suite is 522 tests in 31 files (449 + 73 new); the earlier 449 pass
  unchanged.

## 14. Decision gate

1. **Can version 2 represent the complete reference hybrid?** Yes. Three
   components, three connections, four targets and an output; its
   description equals the standalone reference and builds the same engine
   calls and samples, for both ties.
2. **Are topology and gestures clearly separated?** Yes. Connections are
   bridge, tie and pad only; a strike or a finger written as a connection
   is refused; targets say where; gestures are a separate type that no
   file can hold.
3. **Are port identities stable?** Yes: under parameter changes, moving,
   renaming and reordering.
4. **Are connection semantics unambiguous?** Yes: three kinds, each with
   its two allowed ends, its required parameters with units and ranges,
   and no general kind.
5. **Does four-tier validation work?** Yes: 27 structural cases, 18
   numerical ones, physical errors and warnings, budget errors and
   warnings under two policies, each naming what it concerns.
6. **Is serialization deterministic?** Yes: identical text under every
   reordering, exact round trips, 200 generated cases.
7. **Do all version 1 examples remain compatible?** Yes: all seven read
   back as the builder reads them and build the same engine calls.
8. **Do the fixtures preserve the validated parameters?** Yes; no number
   is new.
9. **Is the implementation isolated?** Yes: nothing imports it and the
   production build is byte-identical.
10. **Is the schema ready for a narrow compiler phase?** Yes, with the
    list in section 12, and subject as before to your listening approval
    of the instrument itself. I have not begun it.
