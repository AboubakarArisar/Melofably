# Instrument builder: architecture design

Status: **design only, superseded.** Phase 3B built a first instrument builder
on the WebAssembly physics engine rather than on generated Faust code as
proposed here: see [BUILDER.md](BUILDER.md). This document is kept as the
record of the earlier analysis. Nothing in it is implemented. It records
how a future instrument builder, in which a user combines physical components,
could be built on what exists, what that would and would not be physically,
and what the present Faust/WebAssembly architecture makes hard.

The TypeScript in this document is illustrative. It is not in the codebase.

## 1. Where we are

Each of the four instruments is one hand-written Faust program, compiled to
one WebAssembly module, hosted by one AudioWorklet node:

```
controls (main thread) --setParamValue--> [ one Faust/WASM node ] --> gain --> analyser --> output
```

Inside each program the signal path is fixed and feed-forward, with one
exception (the string's delay loop):

| Instrument | Exciter | Resonator | Radiation / output |
| --- | --- | --- | --- |
| String | impulse, pick lowpass, pluck-position comb | delay loop with loss filter (waveguide) | 5-mode body, soft limiter |
| Metal bar | half-sine force pulse | 25 x 8 two-pole modes | soft limiter |
| Glass vessel | half-sine force pulse | 25 x 8 two-pole modes | soft limiter |
| Wooden bar | lossy force pulse | 25 x 6 two-pole modes | tube resonator per bar, soft limiter |

What is already reusable: `modal.lib` (resonator, elastic striker, limiter),
the engine's load / warm-up / prime / fade-and-swap lifecycle, the parameter
metadata that flows from Faust JSON to the sliders, and the offline test
harness that measures rendered audio.

What is not there: any notion of a component, any connection between
components other than "signal goes in, signal comes out", and any way to build
a DSP graph that was not written by hand in advance.

## 2. The central distinction: routing is not coupling

Every instrument today is a **one-way chain**. The exciter produces a force
signal that does not depend on what the resonator then does; the resonator's
output feeds a radiation stage that does not push back. This is a good
approximation when the back-reaction is small (a light mallet that has left
the bar before the bar has moved much; a body that takes little energy from a
string per cycle).

Physical coupling is **two-way**. When two objects touch, the force between
them and their motion at the contact point are determined together, each
instant, by both objects. Consequences that only two-way coupling produces:

- Resonances move. A bar on a tube, a string on a bridge, two bars joined by a
  spring: the coupled system has its own modes, which are not the modes of the
  parts.
- Energy flows both ways. A string and a soundboard exchange energy, producing
  two-stage decay and beating. A mallet's contact time depends on how the bar
  moves under it.
- Damping is shared. Coupling a lightly damped object to a lossy one shortens
  the decay of the first.

**Mixing the outputs of two independently rendered instruments produces none
of these.** Adding a glass signal to a bar signal is two instruments playing
at once. Feeding one model's output into another's input is a one-way chain.
Neither is physical coupling, and the builder must never present them as such.
In the builder's vocabulary:

- *Route*: a one-way signal connection. Cheap, always stable, physically a
  statement that the downstream object does not affect the upstream one.
- *Couple*: a two-way connection across which force and velocity are solved
  together. More expensive, with real stability and architecture constraints.

The interface should make the user choose, and label routes as approximations.

## 3. Component model

Four roles. A component declares which role it plays, its ports, and its
parameters.

### 3.1 Ports

A port is a point where power can be exchanged, described by a pair of
variables whose product is power:

| Domain | Effort | Flow |
| --- | --- | --- |
| Mechanical point | force (N) | velocity (m/s) |
| Acoustic | pressure (Pa) | volume flow (m^3/s) |

A route uses one variable in one direction (for example "force out"). A
coupling uses both variables at the same port.

```ts
type Domain = 'mechanical' | 'acoustic'

interface Port {
  id: string                       // "strikePoint", "bridge", "rim"
  domain: Domain
  /** Where on the object, in the object's own coordinates (e.g. fraction of length). */
  position?: ParamRef
  /** What the component can do at this port. */
  supports: ('force-in' | 'velocity-out' | 'coupled')[]
}
```

### 3.2 Exciters

Sources of energy.

```ts
interface ExciterSpec extends ComponentSpec {
  role: 'exciter'
  /**
   * 'prescribed': the force is a function of the controls only (today's
   *   half-sine and lossy pulses, the string's pluck). One-way by construction.
   * 'interacting': the force depends on the motion of what it touches (a
   *   mallet as a mass on a nonlinear spring, a bow, a reed). Needs a coupled port.
   */
  interaction: 'prescribed' | 'interacting'
  ports: [Port]                    // where it acts
}
```

Existing material: elastic half-sine striker, lossy striker, impulse + pick
filter + pluck comb. Candidates later: a mass-spring mallet with Hertz contact
(interacting), a bow (interacting, sustained).

### 3.3 Resonators

Objects that store and exchange vibrational energy.

```ts
interface ResonatorSpec extends ComponentSpec {
  role: 'resonator'
  representation: 'modal' | 'waveguide'
  ports: Port[]                    // strike point, bridge, pickup point...
  /**
   * For modal resonators: everything needed to synthesise and to couple.
   * Computed on the main thread from the parameters.
   */
  modes?: (params: Values) => {
    frequency: number              // Hz
    t60: number                    // s
    modalMass: number              // kg, needed for coupling and absolute levels
    /** Mode shape evaluated at each port. */
    shapeAt: Record<string /* port id */, number>
  }[]
}
```

Existing material: free-free beam (metal and wood), cylindrical shell wall,
ideal string loop. All four already compute frequencies, decay times and mode
shapes at a point; none computes modal mass, because one-way synthesis with
normalised levels never needed it. Coupling does.

### 3.4 Couplings

How two ports are joined.

```ts
interface CouplingSpec {
  kind: 'route' | 'rigid' | 'spring' | 'spring-damper' | 'contact'
  from: PortRef
  to: PortRef
  params?: ParamSpec[]             // stiffness, damping, contact exponent...
}
```

`route` is one-way. The rest are two-way; section 5 covers how each could be
computed.

### 3.5 Radiators and output stages

What turns motion into the signal that is heard.

```ts
interface RadiatorSpec extends ComponentSpec {
  role: 'radiator'
  /** 'filter': a one-way approximation (today's body and tube). 'coupled': loads the source. */
  loading: 'filter' | 'coupled'
  ports: [Port]                    // what it listens to
}
```

Existing material: the string's 5-mode body, the wooden bar's tube resonator
(both one-way filters), the soft limiter (an output protection stage, not
physics, and always last).

Every instrument today outputs the velocity at the excitation point. A real
radiation model (how efficiently each mode radiates, directivity) does not
exist and would be new work.

### 3.6 Common shape

```ts
interface ComponentSpec {
  type: string                     // "free-free-bar", "lossy-mallet"
  role: 'exciter' | 'resonator' | 'radiator'
  label: string
  params: ParamSpec[]
  ports: Port[]
  /** Documentation carried with the component: equations, sources, limits. */
  model: { summary: string; assumptions: string[]; references: string[] }
}
```

The `model` block matters. Each instrument so far ships with a document
separating established equations from approximations and loudness choices. A
builder that lets users combine parts must carry that honesty per part.

## 4. Parameter schema

Today a parameter is whatever the Faust source declares; the JSON emitted by
the compiler supplies address, range, default, step and unit, and the
interface adds a label. That stays the source of truth for hand-written
models. For composed instruments the schema has to exist before any DSP does:

```ts
interface ParamSpec {
  id: string                       // "length", "lossFactor"
  label: string
  unit?: string                    // SI, shown to the user
  min: number
  max: number
  init: number
  step: number
  scale?: 'linear' | 'log'         // loss factors and stiffness span decades
  /**
   * 'physical': a property of the object (length, density, modulus).
   * 'excitation': how it is played (velocity, position, hardness).
   * 'loudness': a level or normalisation choice that is not physics.
   */
  kind: 'physical' | 'excitation' | 'loudness'
  /** Does changing it need new mode data, or a rebuild of the DSP? */
  effect: 'coefficients' | 'modes' | 'topology'
}
```

Rules carried over from the current models:

- **Addresses are namespaced**: `/<instrument>/<component>/<param>`. Several
  components will have a `length` or a `density`; the four instruments already
  share names and are kept apart only because each is its own program.
- **The DSP clamps every input.** A schema range is a courtesy to the
  interface, not a safety mechanism.
- **Values persist per component instance.** The interface already keeps one
  value set per instrument (`withValue`); the builder needs one per component.
- **A saved instrument is a versioned document**: components, their
  parameter values, connections. No audio, no compiled code.

```ts
interface InstrumentDocument {
  version: 1
  components: { id: string; type: string; values: Record<string, number> }[]
  connections: CouplingSpec[]
  voices: { count: number; pitchParam: PortRef | ParamRef; scaling: 'length' | 'size' | 'tension' }
  output: { radiators: string[]; gain: number }
}
```

`voices` deserves a note. The three struck instruments get their keyboard by
instantiating 25 copies of one object at different sizes. That choice (which
dimension scales with pitch, how many copies) is part of an instrument's
definition and must be explicit in the document.

## 5. How two-way coupling could be computed

In rough order of how well each fits what exists.

### 5.1 Modal substructuring (recommended first)

For **linear** couplings (rigid, spring, spring-damper) between **modal**
resonators, the coupled system is itself a set of modes. Given each part's
modal frequencies, masses and mode shapes at the connection points, the
coupled modes follow from a small generalised eigenvalue problem (the parts'
modal coordinates plus the constraint or the spring's stiffness). This is
standard component mode synthesis.

- The eigen-solve happens on the **main thread** when a parameter changes.
- The audio thread synthesises the resulting modes with the same two-pole
  resonators as today. **No feedback loop, no stability problem, no extra
  per-sample cost.**
- It is exact for the linear system described by the retained modes. Its error
  is the truncation: only a finite number of modes per part are kept.

Limits: it needs modal mass, which the current models do not compute. A
coupling that changes while sounding (contact, bowing) is outside it. The
eigen-solve scales with the cube of the total mode count (trivial for two
8-mode parts, noticeable for a 25-key instrument recomputed on every slider
move, so it must be debounced or moved to a worker).

### 5.2 Explicit feedback with a one-sample delay

Compute the contact force from the previous sample's velocities and apply it
this sample. In Faust this is what the `~` operator gives: every feedback loop
contains one sample of delay.

- Simple, and already how the string loop works.
- For a stiff coupling it is **only conditionally stable**: roughly, the
  coupling's own resonance must stay well below the sample rate. A hard mallet
  on a bar violates this at 48 kHz. Oversampling the coupled block buys range
  at proportional CPU cost.
- The delay also adds a small frequency-dependent error to any resonance the
  coupling creates.

Usable for soft couplings (felt, rubber, weak springs). Not a general answer.

### 5.3 Implicit solution per sample

Solve the contact equation for this sample's force and velocities together
(Newton iteration, or the K-method, which precomputes the linear part). This
is how published time-domain mallet-bar and bow-string models are made stable.

- Correct and unconditionally stable when done properly.
- A per-sample iterative solve is awkward in Faust, which has no loops over a
  data-dependent number of iterations; a fixed small number of iterations can
  be unrolled, at a cost in code size and CPU.
- A natural fit for a hand-written AudioWorklet processor (section 6.3).

### 5.4 Wave variables and scattering junctions

Describe each port by incoming and outgoing waves instead of force and
velocity (digital waveguides, wave digital filters). A junction between
components becomes a scattering matrix; choosing the port resistances
correctly removes delay-free loops for linear junctions.

- The string already is a waveguide, so string-to-string and
  string-to-bridge junctions fit naturally.
- Connecting a modal object needs its driving-point impedance as a wave port,
  which is established but more involved.
- Nonlinear elements still need a local solve.

### 5.5 What should be offered when

| Coupling | Method | Verdict |
| --- | --- | --- |
| Route (one-way) | direct signal | Available in principle today. Label as an approximation. |
| Rigid or spring, modal to modal, fixed | modal substructuring | First real coupling to build. |
| Soft contact, weak spring | explicit, one-sample delay | Possible in Faust; needs stability limits enforced. |
| Stiff contact, bowing | implicit per-sample solve | Needs a different DSP host than Faust. |
| String to anything | scattering junction | Later; build on the existing waveguide. |

## 6. What the Faust/WebAssembly architecture imposes

### 6.1 A Faust program is a fixed graph

Topology is decided at compile time. Changing which components exist or how
they are connected means generating new Faust source and compiling it.

- **Compile time.** Measured here with the compiler running under Node: 0.2 s
  for the string, 6 to 8 s for each 200-resonator model. An instrument built
  by the user would need the Faust compiler in the browser (`libfaust-wasm`:
  3.6 MB of WebAssembly plus 2.9 MB of library data), run in a Web Worker so
  the interface stays responsive. Seconds of latency after every structural
  edit is the realistic expectation; the long times come from the `par` over
  25 keys, so a builder should compile one voice and instantiate it N times
  rather than expanding 25 copies in the source.
- **Every rebuild replaces the node.** State (ringing notes) is lost. The
  engine's fade-and-swap already handles this cleanly for whole instruments,
  and would be reused as is.
- **No conditional execution.** A Faust program computes everything, always.
  Idle bars cost exactly as much as sounding ones (section 7 of
  STABILITY.md). There is no way to say "skip this resonator while it is
  silent".
- **Feedback always carries one sample of delay** (section 5.2).
- **Controls are block-rate.** Sliders are read once per 128 samples.
  Parameters that must change within a block (a moving contact point) need to
  be signals, not controls.
- **Single precision.** Low-frequency resonator coefficients lose accuracy
  below roughly 100 Hz; a builder that allows large objects needs either
  double precision (`-double`, about twice the memory traffic) or a different
  resonator structure.

### 6.2 What that means for parameters

Three classes of change, with very different costs:

| Change | Example | Cost |
| --- | --- | --- |
| Coefficients | length, density, damping | Free: recomputed each block inside the DSP. |
| Mode data | anything under modal substructuring | Main-thread eigen-solve, then new tables to the DSP. |
| Topology | add a component, change a connection | Regenerate, recompile, warm up, swap. Seconds. |

The `effect` field of `ParamSpec` exists so the interface can tell the user
which they are about to trigger.

### 6.3 An alternative host for modal instruments

Most of what a builder would make is modal: banks of resonators with tables of
frequency, decay and gain. That does not need a compiler in the loop. One
general **modal engine**, written once (in Faust with table inputs, or as a
hand-written AudioWorklet processor in WebAssembly), could synthesise any
modal instrument from data:

- Topology changes become new tables, sent over the node's message port.
  No recompile, no swap, no lost notes.
- Voice allocation becomes possible: N resonator banks shared among the notes
  being played, instead of 25 always-on copies. This is where the idle CPU
  cost would actually be recovered.
- Implicit contact solves (section 5.3) are straightforward to write.

The cost is leaving Faust for that part: the block diagrams, the automatic
parameter metadata and the proven test harness all assume Faust. A sensible
split is Faust for waveguides and for components worth hand-crafting, and a
data-driven modal engine for composed instruments. This is the main
architectural decision Phase 3 has to make, and it should be made with a
prototype and measurements, not from this document.

## 7. Audio routing and lifecycle

The engine's graph and states would not change shape:

```
[ instrument node ] --> output gain --> analyser --> destination
```

One AudioContext. One live instrument node. What grows is what happens before
a node becomes live. The current sequence, which a builder would extend:

| Step | Today | With a builder |
| --- | --- | --- |
| 1. Describe | a fixed list of four models | an `InstrumentDocument` |
| 2. Validate | n/a | ports match, couplings are supported, parameter ranges sane, stability limits of any explicit coupling |
| 3. Derive | n/a | mode data, eigen-solve for couplings (worker) |
| 4. Build | ahead of time, at `npm run dsp` | generate and compile (worker), or fill tables for the modal engine |
| 5. Warm up | offline render at page load | the same, for the new module |
| 6. Prime | each model once at start | the new module once |
| 7. Swap | fade out, replace node, restore gain | the same |
| 8. Fail safely | error status, context closed | keep the previous instrument sounding; report which step failed |

Step 8 is a change in policy: today a model that fails to load stops audio,
which is right for a fixed set of shipped models. For a user's edit it would
be wrong: a build that fails should leave the last working instrument in
place.

Lifecycle rules that must hold, all of which the current engine already tests
for whole instruments:

- Never more than one AudioContext; never two instruments audible at once.
- A newer request supersedes an older one that is still building.
- Disposal during any step leaves no node, no context and no pending work.
- Nothing is allocated on the audio thread after a node is created.

## 8. Verification carried forward

The practice so far, which a builder must keep:

- Every model's frequencies, decay rates and mode weights are measured from
  rendered audio and compared with the documented equations.
- Approved sound is pinned by sample-exact baselines.
- Browser behaviour (underruns, switching) is measured, not inferred from
  offline speed.

New for coupling: tests that a coupled pair shows what coupling predicts and
that routing does not. For two identical resonators joined by a spring, the
measured mode pair must split by the amount the theory gives, and the split
must vanish when the same pair is merely mixed.

## 9. Open questions

- Is modal mass available in closed form for every resonator worth offering?
  (Yes for the beam and the ideal string; the shell approximation needs work.)
- How many modes per component keep modal substructuring both accurate and
  cheap? This decides whether eigen-solves can run on every slider move.
- Is a data-driven modal engine fast enough in WebAssembly without SIMD?
- What is the smallest useful set of components? A proposal: free-free bar,
  string, cylindrical shell, tube, elastic and lossy strikers, rigid and
  spring couplings.
- How is a user told, in plain words, that a route is an approximation and
  what it leaves out?
