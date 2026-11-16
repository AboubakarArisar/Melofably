# Bringing the hybrid into the builder: architecture and feasibility (Phase 3D.14)

The hybrid instrument (a string whose bridge is a metal bar standing on the
approved soundboard) exists as a validated model and as a standalone page.
This document asks how it could one day be represented and played inside
SonicMatter's visual builder, and how to get there safely.

**It is a design and feasibility study. Nothing is integrated.** The
builder, the production engine, the engine's AudioWorklet processor, the
approved instruments, the Hybrid Lab and every sound are unchanged. The
only code added is a proof of concept that no page uses
(`src/experimental/hybrid/assembly.ts`) and its tests
(`tests/hybrid-builder-feasibility.test.ts`).

Every statement below is marked as one of:

- **[Verified]** established by reading the code and, where stated, by a
  test that runs;
- **[Proposal]** a design I recommend, not built;
- **[Estimate]** a number I expect but have not measured.

No hybrid sound has been listened to. Nothing here depends on, or claims,
listening approval; the plan in section 14 makes that approval its first
gate.

## 1. Baseline

Before editing: HEAD was `99dc7f5` with nothing after it; working tree
clean; lint and build exited 0; the four reference WAV hashes were
unchanged; all 440 tests passed. `99dc7f5` was tagged
`phase-3d13-approved` (it was not tagged before). (The 440-test run was
started on the clean tree and was still going while I read the builder
and wrote the proof-of-concept file, which nothing imports; no existing
file was edited during it.)

## 2. The builder as it is

All **[Verified]** by reading `src/builder/` (graph.ts, translate.ts,
session.ts, audio.ts, examples.ts, Builder.tsx) and by the first two tests
of the feasibility file. Nothing in `src/builder/` was modified.

| aspect | how the builder does it today | file |
|---|---|---|
| Physical components | `Component { id, type, name, x, y, material?, params }`. Seven types: mallet, impulse, metalBar, woodBar, steelString, dampedBox, listener. Each type lists its parameters with unit, range, step, and whether it is `live` | graph.ts |
| Mechanical connections | `Connection { id, type, from, to, stiffness, damping }` between two **components**. Five types: strike, spring, damper, springDamper, bridge. Two components can be joined **once** | graph.ts |
| Connection ports | **There are none in the data.** Where a connection lands is implied by the component's type: a bar has two places, `strikePosition` and `connectionPosition` (engine ports 0 and 1); a string has its bridge end; the box has one fixed bridge point | graph.ts, translate.ts |
| Component parameters | numbers in `params`, validated against the type's ranges: outside a range is refused, never clamped; unknown keys are refused | graph.ts |
| Presets | seven example graphs built with the same editing functions the interface uses | examples.ts |
| Graph validation | `validateGraph` returns every problem in words; `cannotAdd` and `cannotConnect` say why an edit is not allowed. What may share an instrument is a hand-written whitelist: bars with bars; one string with the box; one string with one metal bar and one mallet (and a listener) | graph.ts |
| Engine compilation | `translate` picks one of three translators by which kinds are present. The string instruments are **not** assembled part by part: each translator calls a validated model (`buildPlayableStringBody`, `buildStringBar`) and returns `Built`, a map from graph identifiers to engine indices | translate.ts |
| Live or rebuild | `structureKey` is everything that cannot change while sounding; equal keys mean `liveCalls` (tune, setStiffness with a ramp, setDamping, setShape for the pluck point), otherwise a rebuild | translate.ts, session.ts |
| Runtime controls | `Session.strikeBar`, `strikeExciter`, `play`, and for the string `touch(on)`, `pull`, `release`: one string, one finger | session.ts |
| Saved instruments | `serialize` is `JSON.stringify(graph)` with `version: 1`; `deserialize` fills in properties added since (with the value they had), then validates, and refuses with every reason. One instrument is kept in `localStorage` | graph.ts, Builder.tsx |
| Undo and redo | a history of whole graphs; edits of the same control within 0.6 s merge; 100 steps | graph.ts |
| Audio | one AudioContext, one node of the engine's processor, an analyser, a make-up gain (×8 for pressure), **a limiter** (`DynamicsCompressorNode`, threshold −6 dB, ratio 20), the destination. A rebuild fades out over a few milliseconds, sends `reset … build`, fades in | audio.ts |
| Engine capacity | 128 resonators, 32 solver connections, 16 384 modes | graph.ts, engine |

### What supports the hybrid, and what does not

| needed by the hybrid | today | where the gap is |
|---|---|---|
| A string, a metal bar, the damped box and a mallet as components | all four exist | none |
| A body and a bar in one instrument | **refused**: "A string and its body cannot share an instrument with bars" | the editor's whitelist |
| The string tied to a chosen point of the bar | the bar has one connection point | the editor's data model (no ports) |
| The bar standing on the board at two points | two components can be joined once; the box has one fixed point and no parameters | the editor's data model |
| A bar that can move as a whole | the builder's bars have bending modes only (`barModes`); the rigid-body modes exist in `stringBarBody.ts` | the builder's bar model, not the engine |
| Places for a finger on the bar | none | the editor's data model |
| A mallet on a bar that is part of a string instrument | allowed with a string and one bar | none |
| The body's radiated pressure as the output | exists for the string on its box (`radiate`) | none |
| Two independent fingers | one `touch`, one finger | **the engine's processor** (section 8) and `Session` |
| The mechanics themselves: modal resonators with any number of ports, springs, dampers, contacts, the implicit solver | everything the hybrid needs | **none: the engine is sufficient** |

**The limitations are in the visual editor's data model and in the
processor's single finger. They are not in the physical engine.** The
Hybrid Lab runs the whole instrument on the unmodified engine
(`assembly/engine.ts` has not changed since Phase 3D.4).

One more thing the audit turned up that matters for this instrument: the
builder's audio path has a limiter after a fixed make-up gain. A strong
stroke of the hybrid is 4.1 Pa against a pluck's 0.19 Pa. Put through
today's pressure path it would drive the limiter hard, and the limiter
would then be doing exactly what this project has refused to do to the
hybrid: evening out plucks and strokes. This is a design constraint for
section 7 and a risk in section 13.

## 3. The hybrid as a graph

**[Proposal]**, with its expressibility and compilation **[Verified]** by
the proof of concept.

### Components

| type | role | exists today | parameters it owns |
|---|---|---|---|
| `steelString` | the string | yes | tension (N), length (m), pluck position, pluck strength (N), pluck softness, retrigger: as today |
| `metalBar` | the bar that is the bridge | yes; needs rigid-body modes when it stands on pads | length (m), width (mm), thickness (mm), material, damping: as today. Its places are ports (below), no longer two parameters |
| `dampedBox` | soundboard and enclosed air | yes | none in the first version: plate, cavity and hole are the approved ones |
| `mallet` | the striker | yes | mass (kg), hardness, velocity (m/s): as today |

No new component type is needed. Pads are **connections**, not components:
a pad has no vibration of its own in the validated model, only a stiffness
and a damping between two points.

### Ports

A port is a named point on a component where something mechanical can be
attached. Two kinds:

- **fixed** ports every component of a type has: the string's `end` (its
  bridge end) and `pluck`; the box's `bridge` (the approved point, 0.08 by
  1/3 of the board); the mallet's `head`;
- **placed** ports the user puts on a bar (a fraction of its length, 0 to
  1) or on the board (two fractions, along and across).

### Connections

| type | from → to | what it is in the engine | parameters it owns |
|---|---|---|---|
| `tie` | string `end` → a placed port of a bar | a spring (with the string's residual compliance in series, as the approved bridge has) and optionally a damper | stiffness (N/m), damping (N s/m) |
| `pad` | a placed port of a bar → a port of the board | a spring and a damper side by side | stiffness (N/m), damping (N s/m) |
| `strike` | mallet `head` → a placed port of a bar | a one-sided Hertz contact | none (the mallet owns mass and hardness) |
| `contact` | a placed port of a bar → the hand | a spring and a damper to a body that does not move, both zero until touched | none stored: how hard a finger presses is playing, not instrument |
| `bridge` (existing) | string `end` → the box's `bridge` | the approved bridge spring | none (fixed stiffness) |

Allowed and refused:

- A `tie` goes from a string's end to a bar. Not to the board (that is a
  `bridge`), not from a pluck point, not to a mallet.
- A `pad` goes from a bar to the board. Not bar to bar (that is today's
  spring), not string to board.
- A `contact` is on a bar. The string's own finger stays where the approved
  instrument has it and needs no port.
- A `strike` is a mallet on a bar, as today.
- Nothing connects to the hand except a contact. Nothing connects two
  ports of the same component.

### The path of force, and of sound

This is the part that must not be decoration.

1. The string's end is a point of the string resonator. The **tie** is a
   spring between that point and the bar's tie port. When the string
   moves, the spring stretches and pulls the bar there with a force; the
   same force, reversed, pulls the string. That is one engine connection
   solved implicitly with everything else: the coupling is bidirectional
   by construction.
2. The bar is a resonator with rigid-body modes (up and down, rocking) and
   bending modes. The tie's force excites each in proportion to that
   mode's shape at the tie port.
3. Each **pad** is a spring and damper between a point of the bar and a
   point of the board. The bar's motion at its pad ports stretches them;
   they push the board, and the board pushes back.
4. The board's modes move; its mean motion compresses the air in the box;
   the plug of air in the hole moves.
5. **What is heard** is the board's volume velocity and the hole's flow,
   converted to sound pressure at 1 m by the approved radiation
   conversion. Nothing of the string or the bar is added to it. There is
   no audio connection anywhere in the graph: only mechanical ones, and
   one fixed acoustic output that belongs to the body.

### Default geometry

The reference of Phases 3D.9 to 3D.11, as a graph (this is
`referenceDraft()` in the proof of concept):

| | default |
|---|---|
| string | A2: 73.5 N, 0.65 m, plucked at 0.8 |
| bar | aluminium, 0.1994 m × 20 mm × 5 mm (54 g), note on the string's 6th harmonic |
| bar ports | pads at 0.215 and 0.785; tie at 0.20; strike at 0.5; finger at 0.5 |
| board ports | first pad on the approved bridge point; second pad along the board's length from it, as far as the pads are apart on the bar |
| tie | 1 × 10⁶ N/m, no damper |
| pads | 1 × 10⁶ N/m and 5 N s/m each |
| mallet | 5 g, hardness 0.5 |

## 4. Two ways to model it

| | A: one specialised hybrid component | B: separate components with ports |
|---|---|---|
| What the user places | one block, "String on a bar bridge", with a dozen parameters | a string, a bar, a box, a mallet, and the connections between them |
| Fidelity to the validated prototype | exact by construction | exact **if** the compiler maps the graph onto the validated model: shown possible (section 12) |
| Extensibility | none: a second bar, another body or a different mounting is a new block | new instruments are new graphs |
| Implementation complexity | small: one type, one translator | a schema with ports, typed connections, a validator, a compiler |
| User experience | simplest; but it is a preset, not something built | matches how the builder already works (place, connect, adjust) |
| Performance | fixed and known | bounded by validation |
| Serialization | version 1 could hold it as one more component type | needs a new version with ports |
| Testing | one parity test | parity test plus validator tests |
| Compatibility with existing instruments | untouched | untouched if version 1 is kept as it is |
| Fit with SonicMatter's aim | poor: the user chooses an instrument instead of inventing one | good |

**Recommendation [Proposal]: B's representation with A's acceptance.**

- Store the instrument as **B**: components, named ports, typed
  connections between ports. That is the data model the builder will need
  for anything beyond the three families it knows, and the proof of
  concept shows it is small.
- Compile, at first, only graphs that match a **recognised assembly**,
  each backed by a validated model. The first and only one is the
  bar-as-bridge instrument, compiled through `buildStringBarBody`. Other
  graphs are valid as data and refused by the compiler with a reason, as
  the builder already refuses a wooden bar under a string.
- Widen what is recognised only when a model has been validated, one
  assembly at a time.

This is not a compromise invented for the occasion: it is how the builder
already compiles strings today (three hand-written translators over
validated models, section 2). It keeps the validated physics exactly, it
does not open the door to arbitrary untested topologies, and it does not
paint the data model into a corner.

A is the smaller first step but the wrong direction: every later
instrument would be another opaque block, and the builder would become a
preset selector. A fully general compiler for B (any string on any bar on
any body) is the right direction but is a research programme, not an
integration: it would need rigid-body modes for every bar, a body with
movable bridge points, and validation of every combination.

## 5. Mechanical ports

**[Verified]** where it describes the engine and the validated model;
**[Proposal]** where it describes how the builder should expose it.

In the engine a port is a row of numbers: the value of each of the
resonator's mode shapes at that point. A force at the port drives each
mode in proportion to its number; the port's velocity is the modes'
velocities weighted by the same numbers. There is no other kind of
mechanical interaction point, and none is needed.

| port | position | axis | what resists a force there | units | can it be moved while sounding |
|---|---|---|---|---|---|
| string `end` | the bridge end of the string | transverse, the one direction the string model has | the string's wave impedance, √(Tμ) = 0.51 kg/s for the default string | m, m/s, N | no: it is the end |
| string `pluck` | a fraction of the string's length | transverse | the same | m, m/s, N | **yes**: nothing is attached to it; the builder already moves it live (`setShape`) |
| bar tie, pad, strike, finger | a fraction ξ of the bar's length | perpendicular to the bar's face | at low frequency the bar's rigid body: an effective mass *M* / (1 + 3(2ξ − 1)²), so 54 g at the middle and 26 g at 0.20 for the default bar; at a bending mode, that mode's shape there (zero at a node) | m, m/s, N | no, while a connection is attached: moving the point under a stretched spring would change stored energy. A port with nothing attached could be |
| board `bridge` and pad points | two fractions of the board | perpendicular to the board | the board's modes at that point; the approved bridge point lies on a nodal line of the 330 Hz mode | m, m/s, N | no |
| mallet `head` | the mass itself | along its travel | its mass | kg | no |
| the hand (a contact's other side) | fixed | | infinite: it does not move | | |

All ports of one instrument share a single axis: everything moves
perpendicular to the board. The model has no in-plane motion, no torsion
and no string tension change, so a port needs no direction of its own. A
connection between ports is therefore always meaningful dimensionally:
displacement in metres, force in newtons.

**Compatibility is by connection type, not by a generic "mechanical
link".** The table in section 3 is the whole of it. A generic "connect any
port to any port with a spring" is deliberately not offered: it would make
a string tied to a mallet, or a board hung from the hand, expressible, and
none of those has a validated meaning.

**Energy accounting [Verified].** Each connection type has one place its
energy can be:

| | stores | loses | counted by |
|---|---|---|---|
| tie, pad (spring part) | ½ k x² | nothing | `engine.energy()` |
| tie, pad (damper part) | nothing | c w² per second | `engine.dissipated()` |
| strike (contact) | Hertz potential while touching | nothing | `engine.energy()` |
| finger contact | ½ k x² while down | c w² | both, and `engine.injected(k)` for the work of its spring stiffening or slackening |

Changing a damper is always passive. Changing a stiffness is counted. The
tests of Phases 3D.9 to 3D.13 hold these books to 10⁻⁹ and are unchanged.

**Does the solver need changing? No [Verified].** Every interaction above
is an existing connection type of the engine, and the whole instrument
with four fingers runs on it today.

## 6. Graph validation

**[Proposal]**, with a sample of each tier **[Verified]** in the proof of
concept, which labels every issue with its tier.

The four tiers are kept apart because they call for different responses:
a structural problem is a bug or a corrupt file; a physical one is a
message to the user; a numerical one is a limit to state; a performance
one may depend on the machine.

**1. Structural validity** (the graph is well formed; refuse to load or
edit otherwise)

- identifiers unique, not empty, never reused;
- every connection end names a component and a port that exist;
- each connection type joins only the kinds of port it may (section 3);
- a placed port is a place on its component (one fraction for a bar, two
  for a board, each 0 to 1), and does not reuse a fixed port's name;
- two ports of one component are never joined to each other.

**2. Physical plausibility** (the thing could exist; explain in words)

- a bar that stands on a board stands on **two** pads at two different
  points: one lets it spin, none leaves it in the air;
- the pads are as far apart on the board as on the bar (within 2 mm): a
  bar does not stretch;
- both pad points and the whole bar lie on the board;
- a string's end is held by exactly one thing (a tie or a bridge);
- the body is reachable from the string through mechanical connections,
  or the user is told nothing will be heard (as the builder already says
  of a string with no bridge);
- at most one mallet per bar port.

**3. Numerical stability** (stay inside what has been tried; state the
limit)

- tie and pad stiffness 10⁴ to 10⁸ N/m; damping 0 to 100 N s/m. Tested so
  far for this instrument: pads and tie each 5 × 10⁵ to 2 × 10⁶ N/m (Phase
  3D.11); softer pads, down to 2 × 10⁴, only in the earlier arrangements.
  Outside the tested
  span the range is **[Estimate]**: the solver is unconditionally stable
  for linear springs, but that the *instrument* stays itself is untested;
- finger strengths from the four defined (500 N/m and 2 N s/m to 2 × 10⁴
  and 60);
- a bar whose lowest note is below what can be played at the sample rate
  (the builder already checks this);
- mallet mass and hardness within today's ranges (hardness sets a contact
  stiffness of 10⁶ to 10¹⁰ N/m^1.5; tested at 10⁸ with 2 to 20 g).

**4. Real-time feasibility** (section 11; warn or refuse by budget)

- solver connections, modes, resonators and simultaneous fingers within
  the initial budget.

**What validation must not do.** It must not refuse an instrument for
being unlike the prototype. A bar tuned to another harmonic, a tie at
0.15, softer pads, a second finger place: all are valid, and some are
known to sound different or worse (Phase 3D.10 found a bar exactly on a
harmonic absorbs it). Those are **notes**, as the builder already gives
("only its lowest 5 of 8 overtones…"), not errors. The boundary is
physical meaning, not resemblance.

## 7. From graph to running model

**[Proposal]**; reuse marked. Step 3's feasibility is **[Verified]**.

| step | what happens | reuses |
|---|---|---|
| 1. Parse | read JSON; dispatch on `version`: 1 goes to today's `deserialize` untouched, 2 to the new reader | `deserialize` as is |
| 2. Validate parameters | ranges per type and per connection, tiers 1 to 3 | `checkNumber`, `TYPES` |
| 3. Assemble | recognise the assembly; map components, ports and connections to the validated model's description (`StringBarBody`) | `buildStringBarBody` **unchanged**; the proof of concept's `compileDraft` is 30 lines of mapping |
| 4. Configure the solver | nothing to configure: the engine's `reset` and `build` | as today |
| 5. Route the sound | the body's two outputs, then `radiate` with a stated full scale | `radiation()`, as the string on its box |
| 6. Map excitation | pluck → `pluckCall`; strike → `launch` on the mallet's contact | `pluckCall`, `exciterCalls` |
| 7. Map damping | each contact identifier → its engine connection; touch and release calls per finger | `touchCall`, `barTouchCalls`, `barReleaseCalls` |
| 8. Start audio | one node, as today, once the processor has more than one finger (section 8) | `createPhysicsNode` |
| 9. Report errors | translation issues in words; processor errors posted to the page | `Issue`, the existing error path |
| 10. Replace the instrument | fade, `reset`, build, fade, as today; fingers lifted and their state cleared | `BrowserBackend.rebuild` |

`Built` grows one field (a map from contact identifier to engine
connection, and the finger of the string keyed by the string's identifier)
instead of today's single `finger`. Nothing else in `Built` changes shape.

**Live or rebuild.** By the existing rule: live for string tension, pluck
position, tie and pad stiffness and damping (ramped), bar damping; a
rebuild for geometry and for any port that has a connection.

**The output level** must be decided, not inherited. Proposal: the hybrid
declares a full scale of 8 Pa (as the lab does) and a make-up that leaves
the limiter idle for a strong stroke at the default volume; the builder's
meter already reports `limiting`, and the hybrid's inspector should show
it. This needs your decision because it sets how loud a pluck is in the
builder relative to the string-on-box instrument.

**Parity check.** The compiled hybrid must equal the standalone reference
in two ways, both already demonstrated by the proof of concept:

1. the engine calls are deeply equal to
   `buildStringBarBody(dampable(0.5, tie)).calls`, for both ties;
2. played through the processor with a pluck and a stroke, every sample is
   equal.

These two assertions should be the acceptance test of the compiler stage
and should stay in the suite for good.

## 8. Independent fingers in the production processor

**[Verified]:** the engine's processor has one `touch` state; the lab's
processor extends it with one state per touched connection, by the same
arithmetic, and with one finger produces the same samples (Phase 3D.12's
tests).

| question | finding or proposal |
|---|---|
| Who owns a contact's state | **[Proposal]** the processor, keyed by engine connection index, as the lab's does. The page knows only identifiers and whether each is down |
| Independent transitions | **[Verified]** in the lab's processor: each ramp advances by its own counter; two sent together both start at that sample |
| Deterministic ordering | **[Verified]**: messages are handled in order between blocks; about 7000 numbered events in Phase 3D.13, none out of order; the order of two simultaneous gestures does not change any sample |
| How many at once | **[Proposal]** a fixed number of slots (the lab has 4; 8 is ample for one hand on each of two parts) and a stated error beyond it, never a silent drop |
| Energy accounting | **[Verified]** unchanged: a finger is only `setDamping` plus the engine's own counted stiffness ramp |
| Backward compatibility | **[Verified]** with one finger the output is bit-identical, so every existing instrument, which uses at most one, is unaffected |
| Cost | **[Verified]** none measurable when no finger moves; while one moves the engine is stepped 16 samples at a time, as today |
| Limits | **[Proposal]** slots are a fixed array made with the processor: no allocation while playing |

**Migration path [Proposal].**

1. Move the lab's finger slots into the engine's processor, replacing its
   single `touch` state. The public `touch` call does not change.
2. Guard it with a test that renders every existing instrument and
   example (bars, the string on its box, both string-and-bar hybrids, the
   listener) through the old and the new processor and requires every
   sample equal. The old processor file is kept in the tests as a fixture
   for that comparison, as the Phase 3D.3 engine already is.
3. Only then delete the lab's subclass and `capture.js`, and point the lab
   at the engine's processor. The lab's own tests (22) then guard the
   production file.

An alternative, **not recommended first**: put damper ramps into the
engine itself, as stiffness ramps already are. That would make them
sample-accurate and remove the processor's state altogether, but it
changes the WebAssembly engine, which has been untouched since Phase 3D.4
and on which every approved comparison rests.

## 9. Interaction

**[Proposal]. No interface was built.**

The first version should let a user *play and adjust* the hybrid before it
lets them *assemble* it, because assembling it needs port editing, which
is the largest piece of new interface.

**Stage one of the interface: an example.** "String on a bar bridge"
appears among the examples. Loading it shows four components and their
connections; all are selectable; parameters are editable; the topology is
not.

**Later: assembling.**

| the user wants to | interaction | default and constraint |
|---|---|---|
| add a metal bar | as today | the reference bar |
| tie the string to the bar | drag from the string's dot to the bar: a `tie` is made at a new port | at 0.20; the port can be dragged along the bar's picture between 0.10 and 0.25 without warning, with a note outside it ("further from the bar's node the string loses its fundamental") |
| place the supports | automatic when the bar is dragged onto the board: two pads at 0.215 and 0.785, the first on the bridge point | the pads move together with the bar; their spacing on the board always follows the bar's, so the "bar would have to stretch" error cannot be made by hand |
| connect supports to the board | part of the same gesture | |
| choose the tie position | drag the tie's dot, or a number in the inspector | |
| choose where to pluck | the string's Pluck position, as today | live |
| choose where a finger rests | click the bar's picture to place a finger port; up to three | the middle |
| play | Play, click a component, or keys: pluck, strike, and hold-to-damp for each finger, as in the lab | |

**What a beginner sees:** string tension and length; bar length (shown
with its note and "6th harmonic of the string, 14 cents flat"); tie
position; mallet mass and speed.

**Advanced, folded away:** tie and pad stiffness and damping; pad
positions; bar width and thickness; pluck softness.

**Shown, not edited:** the bar's note against the string's harmonics; the
bar's mass; each finger's state.

The lab's lessons apply (Phase 3D.13): keys must survive the use of lists;
a held finger must be visibly held; the two strengths should be shown in
the same unit.

## 10. Saving and compatibility

**[Proposal]**; the properties it relies on are **[Verified]**.

**A new version, 2, beside version 1. Version 1 is never rewritten.**

Why a new version rather than new fields in version 1 **[Verified]**:
today's builder refuses unknown properties and an unknown version, in
words. So a version 2 file opened in an old builder is refused cleanly,
not misread; and a hybrid cannot be smuggled into a version 1 file.

| | version 2 |
|---|---|
| top level | `{ version: 2, nextId, components, connections }` |
| component | as version 1, plus `ports?: { [name]: place }` for placed ports. The two bar parameters `strikePosition` and `connectionPosition` become ports |
| identifiers | `c<number>` from one counter, never reused: unchanged |
| port identifiers | names unique within a component; fixed names (`end`, `pluck`, `bridge`, `head`) are reserved |
| connection | `{ id, type, from: { component, port }, to?: { component, port }, stiffness?, damping? }` |
| physical values | SI or the builder's present units (mm for a bar's width and thickness), stated per parameter as today |
| gestures | a `contact` connection is the saved thing. How hard and whether down is not saved: an instrument loads with every finger up |
| key bindings | not saved in the instrument in the first version; fixed, as in the lab |

**Loading.**

- `version: 1` → today's `deserialize`, unchanged. The graph it returns is
  used as it is. **No silent conversion to version 2.**
- `version: 2` → the new reader and validator.
- anything else → refused: "saved in a format this version does not know".
  The stored text is left alone.

**Saving.** A graph is saved in the version it was made in. A version 1
instrument stays version 1 until the user does something version 1 cannot
hold (adds a port), and the builder then says so before converting, as one
undoable step.

**Converting 1 → 2, when asked [Proposal].** Mechanical and lossless: each
bar's `strikePosition` and `connectionPosition` become ports `strike` and
`connect`; each connection gets the port its type implied. A test must
show that every version 1 example, converted, compiles to the same engine
calls as before.

**Invalid or outdated files.** Refused with every reason, as today; the
previous instrument stays; nothing is repaired by guesswork.

**[Verified] in the proof of concept:** all seven examples the builder
ships are read back through the version-aware reader exactly as the
builder's own loader reads them and build identical engine calls; a
version 2 file round-trips to identical text; reversing the order of
components and connections in the file changes neither the compiled calls
nor where each identifier lives in the engine.

## 11. Performance and complexity budget

What the reference hybrid asks of the engine **[Verified]**:

| | approved string on its box | hybrid (reference) | hybrid in the lab (three finger places, six pluck places) | engine capacity |
|---|---|---|---|---|
| resonators | 4 | 6 | 6 | 128 |
| modes | 178 | 189 | 189 | 16 384 |
| solver connections | 4 | 9 | 11 | 32 |
| engine memory | 3 145 728 bytes | the same | the same | fixed |

(Modes: string 100, board 76, bar 10 at 48 kHz, the air, the fixed body
and the mallet 1 each.)

What it costs **[Verified, one machine]**: 48 kHz, Chromium 156, this
computer.

| | mean share of a 2.67 ms block |
|---|---|
| approved string on its box | 10 to 11 % |
| hybrid in the lab, played with both fingers | 17 to 18 % |
| the same at 96 kHz | 32 % |
| each further solver connection | about a tenth more (Phase 3D.11: 8 → 9 connections, 13.6 → 14.9 % in Node) |

Worst solver iterations: 3 in ordinary playing, 7 in the densest
five-minute test. No certain overrun and no device underrun in 5 minutes.

**Initial limits [Proposal].** The first column is what has been run; the
second is where I would set the builder's limit and why.

| | tested | initial limit | basis |
|---|---|---|---|
| strings | 1 | 1 | evidence |
| bars standing on the body | 1 | 1 | evidence |
| bodies | 1 | 1 | evidence |
| solver connections | 11 | 12 | evidence: one above what has run; each costs about 10 % |
| simultaneous fingers | 4 | 4 | evidence |
| finger places on a bar | 3 | 3 | evidence |
| modes | 189 | 200 | evidence; the string's 100 dominate |
| sample rate | 44.1, 48, 96 kHz | allow all; note above 48 kHz that cost doubles | evidence |
| mean cost | 18 % of a block | warn above 35 % | **[Estimate]**: twice the measured cost, half of the block |
| instrument switch | new node in the lab; fade and `reset` in the builder | the builder's existing rebuild | not timed for the hybrid: **[Estimate]** tens of milliseconds |

None of this is a guarantee. It is one machine and one browser; the
millisecond clock in the audio thread cannot confirm deadlines (Phase
3D.12); real-time safety is not claimed.

## 12. Feasibility checks

`tests/hybrid-builder-feasibility.test.ts`, 9 tests, all passing. The
proof of concept is `src/experimental/hybrid/assembly.ts`: about 200 lines,
imported by nothing but its tests.

| assumption | result |
|---|---|
| Can the existing graph schema express the hybrid? | **No.** A bar cannot be added to a string on its box, nor a box to a string on a bar; forced by hand, the three are refused by validation and never reach the engine; a connection has no field for where it lands; two components can be joined once; a bar has two places and the body none |
| Can a graph with ports express it? | **Yes.** Four components, five connections, five bar ports, one board port |
| Can the validated model be reconstructed from a declarative description? | **Yes, exactly.** The compiled description equals `dampable(0.5)` and `dampable(0.5, 0.18)`; the engine calls are deeply equal; a pluck and a stroke give the same samples |
| Can the compiler map the necessary ports? | **Yes**, for this assembly, by a 30-line mapping onto `buildStringBarBody`, which is not changed |
| Can several gesture states be represented without ambiguity? | **Yes.** Each finger is addressed by a graph identifier (the string's, or a contact connection's) that maps to its own engine connection; driven together, each reaches its own value |
| Do saved graphs keep stable identities? | **Yes.** Round trip to identical text; order in the file is irrelevant |
| Do today's saved instruments stay readable? | **Yes.** All seven examples, through a version-aware reader: identical graphs, identical engine calls |
| Does an old builder misread a new file? | **No.** It refuses version 2 by name, and refuses unknown properties |
| Is invalidity reported usefully? | Each of nine broken graphs is refused in words and labelled structure, physics, numerics or budget |

Not checked, because it would need production changes: the session and
interface with more than one finger; the limiter with the hybrid's levels;
rebuild timing.

## 13. Risks

| risk | how likely / how bad | mitigation | test that would catch it |
|---|---|---|---|
| Breaking approved instrument playback | low / severe | change no approved file; the four Faust instruments are a different audio path altogether; keep the reference WAV hashes in the suite | the hash check; every stage's regression run |
| Breaking existing builder instruments through the processor change | medium / severe | bit-identity gate: every example rendered through old and new processor, all samples equal, before anything uses the new one | section 8, step 2 |
| Incorrect mechanical topology (the bar as a label) | low / severe | the compiler only maps onto the validated model; deep equality of engine calls with the standalone reference | the parity test, kept permanently |
| Energy-accounting regression | low / severe | no new force, spring or damper type; keep the 10⁻⁹ accounting tests | Phases 3D.9 to 3D.13's tests, unchanged |
| Invalid user-made graphs reaching the engine | medium / moderate | four-tier validation before compilation; the compiler refuses anything it does not recognise, with a reason | a corpus of broken graphs, each with its expected tier |
| Performance degradation | medium / moderate | budget enforced in validation; the meter already shows engine time | the lab's `bench` in the browser at each stage |
| Simultaneous gesture conflicts | low once section 8 is done / moderate | per-connection slots; fixed limit with an error | the lab's 22 tests against the production processor |
| Saved-instrument compatibility | low / severe | version 1 never rewritten or reinterpreted; version 2 separate; conversion explicit and undoable | all examples and a set of stored version 1 files: same graph, same calls |
| The limiter evening out plucks and strokes | **high if nothing is done** / moderate | declare the hybrid's full scale and make-up so that the limiter is idle for a strong stroke; show `limiting` | a render through the builder's gain chain asserting zero gain reduction |
| Confusing physical controls | medium / moderate | example first; advanced settings folded; levels shown in one unit; your listening before any interface | your judgement; no automatic test |
| Excessive implementation complexity | medium / moderate | recognised assemblies, not a general compiler; small stages; each reversible | review of each stage against its stated scope |
| Latency in the builder (about 48 ms by the browser's estimate) | certain / unknown to me | nothing in the page can reduce the device's share | your judgement |

## 14. Staged plan

**[Proposal]. Not started.** Each stage is independently testable, leaves
the application working, and can be reverted by reverting its commit.

**Stage 0. Listening approval.** You play the Hybrid Lab and decide
whether the instrument is worth integrating, and with which tie.
*Nothing below should begin before this.*

**Stage 1. The data model, unused.** *The smallest step.*

- Scope: version 2 graph types (components with ports, typed connections
  between ports), its validator in four tiers, and a version-aware reader.
  Pure data and pure functions. The builder does not import them.
- Files: one new file in `src/builder/` (for example `graph2.ts`), one
  test file. No existing file changes.
- Tests: the proof of concept's, moved and extended: round trip, stable
  identities, each validation rule, every version 1 example read
  unchanged.
- Acceptance: all existing tests pass unchanged; production build
  byte-identical; the builder behaves exactly as before.
- Rollback: delete two files.
- Depends on: stage 0.

**Stage 2. The compiler, unused.**

- Scope: `translate` for version 2, recognising the one assembly, built on
  `buildStringBarBody`. Returns `Built` with a finger map.
- Files: one new file beside `translate.ts`; a test file.
- Tests: deep equality of calls and equality of samples with the
  standalone reference for both ties; refusal with reasons for everything
  else; the budget.
- Acceptance: parity exact; nothing existing changes.
- Rollback: delete two files.
- Depends on: stage 1.

**Stage 3. Several fingers in the engine's processor.**

- Scope: section 8, steps 1 and 2. The only stage that edits a file every
  builder instrument runs on.
- Files: `src/experimental/wasm/processor.js`; the old file kept as a test
  fixture; a test file.
- Tests: every example and every existing render through old and new: all
  samples equal. The lab's finger tests pointed at the new processor.
- Acceptance: bit-identical for everything that exists; two fingers
  independent.
- Rollback: restore one file.
- Depends on: nothing technical; do after stage 0. Can be reviewed on its
  own.

**Stage 4. Session and audio for the hybrid.**

- Scope: `Session` learns `touch(id, on)` for any finger; the backend
  takes the hybrid's full scale and a make-up that keeps the limiter idle;
  rebuild lifts all fingers.
- Files: `session.ts`, `audio.ts`.
- Tests: session tests in Node against the real engine, as today's are;
  zero limiter reduction for a strong stroke; existing session tests
  unchanged.
- Acceptance: existing instruments behave as before; the hybrid, loaded
  from a version 2 graph in a test, plays and damps.
- Rollback: revert the commit.
- Depends on: stages 2 and 3, and your decision on level (section 7).

**Stage 5. The hybrid as an example in the builder.**

- Scope: the canvas draws ports and port-to-port connections for a
  version 2 graph; the inspector edits its parameters; the example is in
  the list; pluck, strike and two hold-to-damp controls. Topology not
  editable.
- Files: `Canvas.tsx`, `Inspector.tsx`, `Builder.tsx`, `examples.ts`.
- Tests: the example compiles to the reference; a browser run as in Phase
  3D.13.
- Acceptance: the builder's hybrid equals the lab's, sample for sample;
  every version 1 example still loads and sounds as before.
- Rollback: revert the commit; no saved file is affected because version 2
  is not yet written to storage by default.
- Depends on: stage 4.

**Stage 6. Saving version 2; converting from version 1 on request.**

- Depends on: stage 5.

**Stage 7. Assembling by hand: placing ports, dragging the tie, a second
instrument family.**

- Depends on: stage 6, and on evidence from use that it is wanted.

Stages 1 to 3 change nothing the user can see and nothing that sounds.
They can be stopped after any one of them at no cost.

## 15. Regression

- The four reference WAV hashes are unchanged.
- **Not modified:** `src/builder/**`, `assembly/engine.ts`,
  `src/experimental/wasm/**` (the processor included), `src/audio/**`,
  `src/App.tsx`, `src/experimental/string/**`, the Hybrid Lab
  (`hybrid-lab.html`, `lab.ts`, `instrument.ts`, `hybrid-processor.js`,
  `capture.js`), every page, `vite.config.ts`, `package.json`.
- **New only:** `src/experimental/hybrid/assembly.ts` (imported by nothing
  but its tests), `tests/hybrid-builder-feasibility.test.ts`, this
  document; README, ROADMAP and TESTING gain a few lines.
- Saved-instrument behaviour is unchanged because the code that saves and
  loads is unchanged; the feasibility tests additionally show every
  example reads and builds as before.
- The production build is byte-for-byte what it was.
- The suite is 449 tests in 30 files (440 + 9 new); the earlier 440 pass
  unchanged.

## 16. Decision gate

1. **Can the existing builder architecture represent the hybrid?**
   **[Verified] No**, not as it is: it forbids a bar and a body together,
   has no ports, and allows one connection between two components. Its
   *approach* (validated models behind a small set of recognised graphs)
   fits the hybrid well.
2. **What minimum new abstractions are required?** **[Proposal]** Three:
   named ports on components; connections between ports, with two new
   types (tie, pad) and a contact; a map from contact to engine
   connection in `Built`. Plus one change outside the graph: several
   fingers in the processor. No new component type and no engine change.
3. **Specialised assembly or composable components?** **[Proposal]**
   Composable in how it is stored, specialised in what is compiled at
   first: components and ports in the file, recognised assemblies in the
   compiler.
4. **Can the validated physical engine be reused?** **[Verified] Yes,
   unchanged**, engine and model both. A graph compiles to exactly the
   reference's engine calls.
5. **How should ports and connections be represented?** **[Proposal]**
   Ports as named places on a component (fixed by type or placed by the
   user); connections as typed links between `{ component, port }` pairs,
   each type allowed between stated kinds of port only. One axis, SI
   units, energy accounted per type.
6. **How should independent gestures be supported?** **[Proposal]**
   Per-connection finger state in the engine's processor, migrated from
   the lab's behind a bit-identity gate; addressed from the page by graph
   identifier. **[Verified]** that this is bit-identical for one finger
   and independent for several.
7. **Can old saved instruments remain compatible?** **[Verified]** that
   today's files read and build identically beside a new format and that
   old builders refuse new files rather than misread them. **[Proposal]**
   version 1 is never rewritten; conversion is explicit.
8. **What are the initial performance limits?** **[Proposal, on
   evidence]** one string, one bar, one body; 12 solver connections; 4
   fingers; 200 modes; about 18 % of a block at 48 kHz on the one machine
   measured. **[Estimate]** a warning at 35 %.
9. **What are the highest integration risks?** Changing the processor
   that every builder instrument uses; the builder's limiter evening out
   the hybrid's dynamics; interface complexity around ports. Each has a
   mitigation and a test (section 13).
10. **What is the smallest safe implementation step?** **[Proposal]**
    Stage 1: the version 2 data model, validator and reader as pure code
    that nothing imports. It cannot change a sound or a saved file, and it
    is deleted by removing two files.

## 17. Recommendation

Listen first. If the instrument earns its place, approve stages 1 and 2
together (pure code, no behaviour change, exact parity as the acceptance
test), and stage 3 separately with its own review, since it is the one
that touches something every builder instrument depends on. Decide the
level question of section 7 before stage 4. I have not begun any of it,
and have not begun Phase 3D.15.
