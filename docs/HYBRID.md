# A string tied to a metal bar: the first hybrid (Phase 3D.2)

**Status: experimental, narrow.** One string, one metal bar, at most one
mallet. The four approved Faust instruments, their reference recordings, the
WebAssembly engine, the three bar examples, the string-and-body instrument
and its playing interactions are unchanged. No listening was done: the model
that wrote this cannot hear. Every statement about sound is a measurement.

| Piece | Where |
| --- | --- |
| The string tied to a bar as one engine system | `src/experimental/string/stringBar.ts` |
| Graph rules, translation, live edits | `src/builder/graph.ts`, `translate.ts` |
| Example, joint panel, canvas hint | `src/builder/examples.ts`, `Inspector.tsx`, `Canvas.tsx` |
| Tests (17) | `tests/string-bar.test.ts` |
| Listening renders, measurements, Node timing | `analysis/render-string-bar.ts` (`npm run render:string-bar`) |

## 1. Why strings and bars were kept apart

Looked for in the code, not assumed. There were five separate things, and
the engine was not one of them.

| Kind | Where | What it was |
| --- | --- | --- |
| Interface | the palette (`cannotAdd` in `graph.ts`) | A string or body could not be added to a canvas with bars, nor bars to one with a string. |
| Graph validation | `incompatible` and `validateGraph` in `graph.ts` | A string could be joined only to a body, only by a bridge; a saved graph with both was refused. |
| Translation | `translate()` in `translate.ts` | Any graph with a string was handed whole to the string-and-box translator, which did not look at bars. |
| Engine | none | The engine holds any modal resonators joined by any springs, dampers and contacts. Phase 3C.1 ran a string on a bar in it. |
| Physical connection | the string model | The string's bridge end is free until something holds it. A damper alone does not hold it; a spring does. |
| Output | `processor.js`, `audio.ts` | A bar instrument's output is the sum of bar velocities (m/s). The box instrument's is sound pressure, made by differentiating and filtering the engine's **whole** output. One engine output cannot be both. |

So the real obstacle was the output, and after it the rule that a string's
end needs a spring. Nothing had to be rewritten.

## 2. The hybrid

```
finger ──force──▶ STRING (100 modes) ──spring k, damper c──▶ METAL BAR (8 modes) ◀──contact── MALLET
                                                                   │
                                                  heard: the bar's velocity where it is struck, m/s
```

The string's free end is tied to the bar's connection point by a spring and,
if wanted, a damper. It is one system in the existing engine, solved together
every sample by the same solver that joins two bars: the string pulls the
bar through the joint and the bar pulls the string. The spring the engine
holds also carries the allowance for the string's missing modes, as the
box's bridge does. The string keeps its finger (a damper at its pluck point,
Phase 3D.1), so retrigger, mute and pull-and-release work unchanged. The bar
keeps its mallet: a free mass and a Hertz contact, as in every bar
instrument.

The builder's example: the A2 string (73.5 N, 0.65 m, 3.6 g/m) and an
aluminium bar 0.40 m x 40 mm x 10 mm, tied at 0.1 of the bar's length by a
spring of 1e6 N/m, with a 20 g mallet.

**Tuning is what makes it a useful pair.** The bar's lowest note is 327 Hz,
beside the string's third harmonic at 330 Hz. A bar whose notes are far from
every harmonic of the string hardly hears it:

| Bar | Lowest note | Plucked string (2 N): most of the energy the bar held | Bar velocity |
| --- | --- | --- | --- |
| 0.30 m x 10 mm (the builder's starting bar) | 582 Hz | 0.11 % | 0.0025 m/s |
| **0.40 m x 10 mm (the example)** | 327 Hz | **9.7 %** | **0.024 m/s** |
| 0.40 m x 6.7 mm | 219 Hz (beside harmonic 2) | 35 % | 0.052 m/s |
| 0.50 m x 5 mm | 105 Hz (beside the fundamental) | 60 %, and the string is pulled 101 cents flat | 0.056 m/s |

## 3. Measurements of the coupling

The example pair, in the engine through the AudioWorklet processor.

| | Result |
| --- | --- |
| String plucked, 2 N | the bar holds up to **9.71 %** of the energy and moves at up to 0.0236 m/s; string pitch 109.89 Hz, -0.3 cents |
| Bar struck, 20 g at 1.5 m/s | the string holds up to **5.74 %** of the energy; the bar moves at up to 0.308 m/s |
| No losses anywhere | total energy drifts by 4.6e-12 over 3 s; the bar's share swings between 0.00 and 10.32 %: exchange, not a one-way leak |
| Joint removed, string plucked | bar energy exactly 0, output exactly 0 (the string holds 0.31 mJ) |
| Joint removed, bar struck | string energy exactly 0 |
| Damper in the joint, energy 2 s later | -32.7 dB with none, -36.3 dB at 10 N s/m, -44.5 dB at 100 N s/m; energy never rises |
| 100 plucks of 8 N and 50 strokes at 5 m/s in 5 s | no fault, bar velocity up to 1.42 m/s (ceiling 4), Newton iterations at most 3, string and bar die away |

Joint stiffness, no damper:

| Spring | String pitch | Most of the energy in the bar (plucked) | In the string (struck) |
| --- | --- | --- | --- |
| 1e3 N/m | -180 cents | 0.15 % | 0.12 % |
| 1e4 N/m | -19.5 cents | 11.9 % | 7.2 % |
| 1e5 N/m | -2.1 cents | 10.5 % | 6.1 % |
| **1e6 N/m** | **-0.3 cents** | **9.7 %** | **5.7 %** |
| 1e8 N/m | -0.1 cents | 9.6 % | 5.7 % |

A soft spring lets the end of the string give: the pitch falls, and below
about 1e4 N/m the string is hardly tied at all. From 1e5 N/m up it is held
and the transfer no longer depends on the spring. A damper beside a stiff
spring has little relative motion to work on, which is why it takes
100 N s/m to do much at 1e6 N/m.

## 4. What is heard

**The bar, and only the bar: its velocity where it is struck, in m/s**, the
listening output every bar instrument already has. The string is heard
through the bar and in no other way.

Why this, and not a mix:

- A string by itself moves almost no air; that is why string instruments
  have bodies. Here the bar is the body. Hearing the string only through it
  is the same statement the box instrument makes.
- The alternative, adding the string's own motion to the output, would need
  a gain between two different quantities chosen by ear. That is the
  arbitrary mixing this phase was told to avoid.
- It changes nothing that was approved: bar instruments keep their output,
  the box instrument keeps its pressure, and the hybrid is a bar instrument
  with something tied to it.

What it is not: sound pressure. Bars have never had a radiation model here
(a free bar is a poor and complicated radiator), so:

1. The hybrid's level (m/s) and the box instrument's (Pa) cannot be
   compared. Loading one after the other, the difference in loudness comes
   from the listening gains, not from physics.
2. **A plucked string is 22 dB below a mallet stroke** on this bar (0.024
   against 0.31 m/s). That is physical: a string cannot throw a bar about
   as a mallet can. The example plucks at 4 N rather than 2 N for that
   reason, which gains 6 dB.

A shared, calibrated radiation model for bars and plates is the proper
answer and is larger than this phase.

## 5. Playing it

- **Pluck the string**: click it, drag across it and let go, or select it
  and press its button. Hold M or Hold to mute to rest a finger on it;
  Touch before plucking retriggers. All as on the box.
- **Strike the bar**: double-click the bar or its mallet. Without a mallet
  the bar is tapped where it is struck, as a bar on its own is.
- **Play instrument** (Space) does both: plucks the string and throws the
  mallet.
- A finger on the string stops the string and leaves the bar ringing (test).

| Property | | |
| --- | --- | --- |
| Joint stiffness, 100 to 1e8 N/m | live | follows the tension too |
| Joint damping, 0 to 100 N s/m | live | only when the joint is Spring and damper |
| Joint kind: Spring, or Spring and damper | rebuild | a damper alone is refused: it cannot hold the end of a string |
| Point on the bar | rebuild | as for any bar |
| String and bar properties | as before | tension, pluck properties and the bar's damping are live |

**Allowed, and nothing else:** one string, one metal bar, at most one
mallet, the string tied to the bar by a spring. A wooden bar, a second bar,
an impulse strike, a second mallet, or a box together with a bar are
refused with the reason, in the palette and when a saved instrument is
loaded. Bars without a string are as free as they always were.

## 6. Performance

Chromium 156 AudioWorklet at 48 kHz, the builder page live, mains power,
machine lightly loaded. The pane was not in front, which slows the page's
own timers, so each row was played about twice a second.

| Instrument | Engine CPU, of one core | Blocks of 2 ms or more | Blocks processed / expected | Faults | Device dropouts |
| --- | --- | --- | --- | --- | --- |
| Hybrid, nothing played (6 s) | 8.2 % | 2 of 2314 | 2314 / 2311 | 0 | 0 |
| **Hybrid, plucked and struck (10 s)** | **8.7 %** | 1 of 3851 | 3851 / 3851 | 0 | 0 |
| Hybrid, 368 live joint edits with plucks, strokes and touches (10 s) | 10.3 % | 2 of 3757 | 3757 / 3755 | 0 | 0 |
| String on its box, plucked (10 s) | 11.0 % | 0 of 3858 | 3858 / 3858 | 0 | 0 |
| One metal bar and a mallet (10 s) | 0.6 % | 0 of 3806 | 3806 / 3797 | 0 | 0 |

Node, each played three times a second for 10 s:

| Instrument | Modes | Connections | % of one core | Longest block |
| --- | --- | --- | --- | --- |
| Hybrid | 110 | 3 | 5.9 | 2.0 ms |
| String on its box | 178 | 4 | 8.9 | 2.7 ms |
| One metal bar and a mallet | 9 | 1 | 0.5 | 0.3 ms |

- The hybrid costs about two thirds of the box instrument: it has a bar's 8
  modes where the box has 76 and an air cavity. Nearly all of it is the
  string.
- Five blocks of 2 ms or more in about 9900 for the hybrid (budget 2.67 ms,
  clock 1 ms), none for the box in the same session, and no dropout from
  either. The worklet does not report its longest block; Node's is above.
- Engine memory stayed at 3 145 728 bytes. The page's heap moved between 39
  and 77 MB with no trend; one audio node and one context throughout.
- The browser's offline render of the hybrid example gives the same peak,
  sum of squares and five spot samples as Node, to all 17 digits; the box
  instrument still gives the Phase 3C.3 digits.

## 7. Listening files

`npm run render:string-bar` writes 12 files to `renders/string-bar/`, with
`listening.json`, `measurements.json` and `performance.json`. The unit is
metres a second: the bar's velocity where it is struck, except in file 1.
Files in a group share one gain, so differences inside a group are real.

| Files | What | Peak | Gain |
| --- | --- | --- | --- |
| `1` | The string by itself: tied to a bar that cannot move, and its own velocity recorded 0.3 along it. Not a sound: a string alone moves almost no air. | 4.4 m/s | -18.9 dB |
| `3`, `5a`, `6a`, `7a` | String plucked (4 N), heard through the bar: tied at 1e6 N/m; weak, 1e4; strong, 1e8; damped, 1e5 with 30 N s/m | 0.047 / 0.051 / 0.047 / 0.041 m/s | +19.8 dB all |
| `2`, `4`, `5b`, `6b`, `7b`, `8` | Bar struck (20 g at 1.5 m/s): alone; tied; weak; strong; damped; connection removed | 0.31 m/s each | +4.2 dB all |
| `9` | The builder's example: plucks and strokes in turn, the last stroke with a finger on the string | 0.31 m/s | +4.1 dB |

With the connection removed and the string plucked, every sample is zero, so
there is no file; `8` is the bar struck with the connection removed, and is
`2` again. The struck files differ little in level: what the string changes
is what follows the stroke, the 5.7 % of the energy it takes and gives back.

## 8. Tests and regressions

17 new tests in `tests/string-bar.test.ts`: energy both ways; conservation
without losses; dissipation with a damper; connection removal; joint
stiffness; tuning; hard repeated playing from both ends; that the output is
the bar's velocity and nothing else; that the builder's example is the
isolated system call for call and sample for sample; playing either part;
live and rebuilding edits; the string's gestures on the bar; the graph rules;
undo, redo, save and restore; and that the box instrument and the three bar
instruments give the same samples as before.

One earlier assertion was changed. Phase 3C.3 asserted that a string could
not be added to "one metal bar and a mallet". That is now the one hybrid
allowed, so the assertion expects it to be allowed, and the refusal is
asserted on a two-bar and a wood-and-metal instrument instead.

## 9. Was the builder integration done

Yes, narrowly. The gate was checked on the isolated prototype first:

| Condition | Result |
| --- | --- |
| Numerically stable | no fault at any stiffness from 1e3 to 1e8 N/m, any damping, or under the hardest playing; Newton iterations at most 3 |
| Physically consistent | energy kept to 5e-12 without losses; exactly nothing crosses a removed joint; exchange in both directions; a damper only takes |
| Computationally practical | two thirds of the box instrument's cost |
| A meaningful audible signal | a plucked string moves the bar at 0.024 m/s, 22 dB under a mallet stroke: quiet, and clearly there |

## 10. Limitations

1. **No radiation model for the bar**: the output is a velocity, as for all
   bars. Not comparable in level with the box instrument (section 4).
2. **The plucked string is quiet** beside the struck bar, by 22 dB.
3. **Only this pair.** One string, one metal bar, one mallet. No wooden bar,
   no impulse strike, no second bar, no box together with a bar.
4. **The pair must be tuned** to exchange much (section 2). The inspector
   shows each part's notes; nothing yet shows how near they are.
5. **The bar has no rigid-body motion**: it is held as every builder bar is,
   free to bend but not to move as a whole. A string tied to a bar that
   could swing would behave differently.
6. **A soft joint detunes the string.** That is the physics of a string
   whose end gives, not an error, but it surprises.
7. **A thrown mallet flies on**: after it bounces off the bar it keeps its
   energy, as in every bar instrument, so the engine's total energy does
   not fall to zero after a stroke.
8. **Performance was measured on one machine and one browser**, with the
   browser pane in the background.
9. **Not heard.**

## 11. Trying it

`npm run dev`, open `http://localhost:5173/builder.html`, choose **A string
tied to a metal bar** under "Experimental: string and body", press **Start
audio**.

1. Click the string: a pluck, heard through the bar.
2. Double-click the bar or the mallet: a stroke. Listen for the string
   ringing on after it.
3. Press Space: both.
4. Select the zigzag between the string and the bar. Drag **Stiffness** down
   to 10 000: the string goes flat while it rings. Change **Kind** to Spring
   and damper and raise the damping.
5. Press **Remove connection**: plucking is silent and a note says why; the
   bar still sounds when struck. Undo.
6. Strike the bar, then hold M: the string stops and the bar rings on.
7. Select the bar and change its **Length**: at 0.30 m it barely answers
   the string; at 0.40 m it does.
8. Try to add a wooden bar or a second bar: the palette says why not.
