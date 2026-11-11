declare name "string";
declare description "Plucked ideal string: single-delay-loop digital waveguide";

import("stdfaust.lib");

// One string, fixed at both ends, modelled as a single delay loop (the
// Karplus-Strong / Jaffe-Smith form of a digital waveguide). Approximations
// are documented in docs/STRING_MODEL.md.

MAXN = 8192; // longest loop in samples (lowest pitch = SR / MAXN)

clip(lo, hi) = max(lo) : min(hi);

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
// Fretting: the key pressed shortens the vibrating length by 2^(-fret/12).
fret  = hslider("fret", 0, 0, 24, 1)                : clip(0, 24);
// Pluck trigger: the host increments this; any change plucks the string.
pluck = hslider("pluck", 0, 0, 1000000, 1);

// ---- physics --------------------------------------------------------------
// Ideal string: wave speed c = sqrt(T / mu), fundamental f0 = c / (2 L).
vibratingLength = len * pow(2, 0 - fret / 12);
f0 = sqrt(tens / dens) / (2 * vibratingLength);
// One round trip of the wave (2 L at speed c) in samples.
N = ma.SR / f0 : clip(8, MAXN);

trig = pluck != pluck';

// ---- excitation -----------------------------------------------------------
// An ideal pluck is an impulse in the acceleration wave variable. The pick is
// not infinitely sharp: a one-pole lowpass rounds it, more so for soft plucks.
pickCutoff = 400 + 11600 * str * str : min(0.45 * ma.SR);
pick = si.smooth(exp(0 - 2 * ma.PI * pickCutoff / ma.SR));
// Pluck position: the pulse travelling the other way arrives pos * N samples
// later with opposite sign, which cancels every harmonic that has a node at
// the pluck point.
pluckComb = _ <: _, (de.fdelay(MAXN, pos * N) : *(0 - 1)) :> _;
// Leaky integration turns acceleration into velocity/force, so the loop
// carries (and the output is) the force the string applies to the bridge: a
// rectangular wave whose duty cycle is the pluck position. The 20 Hz leak
// keeps the excitation, and therefore the loop, free of DC.
integrate = fi.pole(exp(0 - 2 * ma.PI * 20 / ma.SR));
excitation = trig * str : pick : pluckComb : integrate;

// ---- string loop ----------------------------------------------------------
// Loop delay budget, in samples: N = (N - 2) delay line + 1 loss filter + 1
// feedback. The delay line uses 4th-order Lagrange interpolation so the
// fractional part of N is honoured and the pitch is exact.
//
// Losses per round trip:
//  - lossFilter: symmetric 3-tap FIR, gain 1 at DC falling with frequency
//    (high partials die first), exactly 1 sample of delay at all frequencies,
//    gain never above 1.
//  - loopGain: frequency-independent decay giving a 60 dB decay time of t60.
// Both are <= 1 at every frequency, so the loop is passive and cannot grow.
t60 = 12 * pow(0.25 / 12, damp);          // 12 s (damping 0) .. 0.25 s (1)
loopGain = pow(10, 0 - 3 * N / (ma.SR * t60));
a = 0.01 + 0.24 * damp;
lossFilter = _ <: *(a), (mem : *(1 - 2 * a)), (mem : mem : *(a)) :> _;

// A new pluck first stops the string (as a finger does): feedback is muted
// for just under one round trip while the new excitation enters the line.
sinceTrig = (+(1) : *(1 - trig) : min(1000000)) ~ _;
ringing = sinceTrig >= (N - 4);

string = + ~ (de.fdelay4(MAXN, N - 2) : lossFilter : *(loopGain * ringing));

// ---- output ---------------------------------------------------------------
// The final clamp is a safety net only; normal levels peak near 0.5.
process = excitation : string : *(0.5) : clip(0 - 1, 1);
