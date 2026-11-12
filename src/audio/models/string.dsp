declare name "string";
declare description "Plucked ideal string (single-delay-loop digital waveguide) driving a modal body";

import("stdfaust.lib");
import("modal.lib");

// One string, fixed at both ends, modelled as a single delay loop (the
// Karplus-Strong / Jaffe-Smith form of a digital waveguide), followed by a
// small modal model of an instrument body. Approximations are documented in
// docs/STRING_MODEL.md.

MAXN = 8192; // longest loop in samples (lowest pitch = SR / MAXN)


// ---- controls -------------------------------------------------------------
// Physical parameters are smoothed so that dragging a slider bends the pitch
// instead of clicking, then clamped so the model can never leave a valid range
// (the smoother starts at 0, and a host could send out-of-range values).
len   = hslider("length[unit:m]", 0.65, 0.3, 1.2, 0.001)           : si.smoo : clip(0.3, 1.2);
tens  = hslider("tension[unit:N]", 73.5, 30, 200, 0.1)             : si.smoo : clip(30, 200);
dens  = hslider("density[unit:kg/m]", 0.0036, 0.0004, 0.01, 0.0001) : si.smoo : clip(0.0004, 0.01);
damp  = hslider("damping", 0.3, 0, 1, 0.001)        : clip(0, 1);
pos   = hslider("pluckPosition", 0.2, 0.02, 0.5, 0.001) : clip(0.02, 0.5);
str   = hslider("strength", 0.8, 0, 1, 0.001)       : clip(0, 1);
// Sound character (Phase 1.1).
bright = hslider("brightness", 0.4, 0, 1, 0.001)    : clip(0, 1);
soft   = hslider("softness", 0.3, 0, 1, 0.001)      : clip(0, 1);
bodyAmt = hslider("body", 0.6, 0, 1, 0.001)         : si.smoo : clip(0, 1);
// Fretting: the key pressed shortens the vibrating length by 2^(-fret/12).
fret  = hslider("fret", 0, 0, 24, 1)                : clip(0, 24);
// Pluck trigger: the host increments this; any change plucks the string.
pluck = hslider("pluck", 0, 0, 1000000, 1);

// ---- physics --------------------------------------------------------------
// Ideal string: wave speed c = sqrt(T / mu), fundamental f0 = c / (2 L).
// Nothing below this block changes the loop length, so nothing else can
// change the pitch.
vibratingLength = len * pow(2, 0 - fret / 12);
f0 = sqrt(tens / dens) / (2 * vibratingLength);
// One round trip of the wave (2 L at speed c) in samples.
N = ma.SR / f0 : clip(8, MAXN);

trig = pluck != pluck';

// ---- excitation -----------------------------------------------------------
// An ideal pluck is an impulse in the acceleration wave variable. A real
// finger or plectrum has width and takes time to let go, which rounds the
// impulse: two one-pole lowpasses (12 dB/octave). `softness` sets the
// cutoff from 8 kHz (hard, narrow plectrum) down to 600 Hz (soft fingertip);
// a weaker pluck is also slightly duller.
pickCutoff = 8000 * pow(600 / 8000, soft) * (0.4 + 0.6 * str) : min(0.45 * ma.SR);
onePole = si.smooth(exp(0 - 2 * ma.PI * pickCutoff / ma.SR));
pick = onePole : onePole;
// Pluck position: the pulse travelling the other way arrives pos * N samples
// later with opposite sign, which cancels every harmonic that has a node at
// the pluck point.
pluckComb = _ <: _, (de.fdelay(MAXN, pos * N) : *(0 - 1)) :> _;
// Leaky integration turns acceleration into velocity/force, so the loop
// carries the force the string applies to the bridge: a rectangular wave
// whose duty cycle is the pluck position, with edges rounded by the pick. The
// 20 Hz leak keeps the excitation, and therefore the loop, free of DC.
integrate = fi.pole(exp(0 - 2 * ma.PI * 20 / ma.SR));
excitation = trig * str : pick : pluckComb : integrate;

// ---- string loop ----------------------------------------------------------
// Loop delay budget, in samples: N = (N - 3) delay line + 2 loss filter + 1
// feedback. The delay line uses 4th-order Lagrange interpolation so the
// fractional part of N is honoured and the pitch is exact.
//
// Losses per round trip:
//  - loopGain: frequency-independent decay giving a 60 dB decay time of t60.
//  - lossFilter: two symmetric 3-tap FIRs [a, 1-2a, a]. Gain 1 at DC, falling
//    with frequency, never above 1, and exactly 2 samples of delay at every
//    frequency, so it cannot detune the string.
// Both are <= 1 at every frequency, so the loop is passive and cannot grow.
//
// Each FIR's loss per round trip is about a * w^2 (w in rad/sample). A string
// makes f0 round trips per second, so a fixed `a` damps the highs of a high
// note far faster, in seconds, than those of a low note. Real strings lose
// energy at a rate set by the frequency of the partial, roughly
// sigma * (2 pi f)^2 per second, whatever the note. Matching that needs a
// total a = sigma * SR * N, i.e. more filtering per trip on longer loops.
// `brightness` sets sigma through the decay time of a 5 kHz partial.
t60 = 12 * pow(0.25 / 12, damp);           // 12 s (damping 0) .. 0.25 s (1)
loopGain = pow(10, 0 - 3 * N / (ma.SR * t60));
hfT60 = 0.25 * pow(10, bright);            // 5 kHz partial: 0.25 s .. 2.5 s
sigma = 6.91 / hfT60 / pow(2 * ma.PI * 5000, 2);
// Damping the string (e.g. with the palm) also dulls it. a = 0.25 per section
// is the most a 3-tap filter can do; two sections reach the target for
// strings down to about 100 Hz, below which the dullest settings saturate.
a = sigma * ma.SR * N * (0.5 + 2 * damp) / 2 : clip(0, 0.25);
fir3 = _ <: *(a), (mem : *(1 - 2 * a)), (mem : mem : *(a)) :> _;
lossFilter = fir3 : fir3;

// A new pluck first stops the string (as a finger does): the old vibration is
// kept out of the loop for just under one round trip while the new excitation
// enters the line. At the output it is faded over <= 32 samples rather than
// cut, to avoid a click.
sinceTrig = (+(1) : *(1 - trig) : min(1000000)) ~ _;
ringing = sinceTrig >= (N - 5);
fadeOut = max(0, 1 - sinceTrig / min(32, N / 4));

// loop(fb, exc): fb is the wave returning from the string. Outputs the wave
// sent back down the string and the bridge-force output.
loop(fb, exc) =
    (fb * ringing + exc : de.fdelay4(MAXN, N - 3) : lossFilter : *(loopGain)),
    (exc + fb * select2(ringing, fadeOut, 1));
string = (loop ~ _) : !, _;

// ---- body -----------------------------------------------------------------
// The string alone gives the force on the bridge. An acoustic instrument's
// body turns that force into sound: a few strong low resonances plus a
// broadband response that rolls off at high frequency. Modelled as parallel
// two-pole resonators (modal synthesis) beside a band-limited direct path.
// Mode frequencies are typical of a guitar-sized body (air resonance near
// 100 Hz, main top-plate resonance near 200 Hz); they are representative
// values, not measurements of a particular instrument. It is a fixed linear
// filter after the loop, with no path back into the string, so it cannot
// alter the pitch.
// mode(f, q, g): resonance at f Hz with gain g at its peak (fi.resonbp's own
// peak gain is its gain argument times Q). Gains are relative to the direct
// path and deliberately moderate, with low Q: strong, narrow body modes make
// notes that land on them boom while their neighbours do not.
mode(f, q, g) = fi.resonbp(f, q, g / q);
body = _ <:
    (fi.highpass(1, 70) : fi.lowpass(2, 6000)),
    mode(98, 8, 2.0), mode(204, 10, 2.5), mode(290, 8, 1.5),
    mode(425, 8, 1.5), mode(560, 8, 1.0)
    :> *(0.55);
withBody = _ <: *(1 - bodyAmt), (body : *(bodyAmt)) :> _;

// ---- output ---------------------------------------------------------------
// Transparent below 0.8, then a smooth knee that approaches but never reaches
// 1: no hard clipping, and no gain change at normal levels.

// Gain chosen so a single note at full strength peaks near 0.5 and fast
// repeated notes stay below the knee.
process = excitation : string : withBody : *(0.58) : softLimit;
