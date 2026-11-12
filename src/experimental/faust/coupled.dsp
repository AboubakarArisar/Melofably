declare name "coupled";
declare description "EXPERIMENT (Phase 3A): two mass-spring oscillators joined by a spring, the way Faust expresses coupling";

import("stdfaust.lib");

// Not an instrument and not used by the application. This is the comparison
// case for the experimental engine: the same two-oscillator system, written
// in Faust. Kept outside src/audio/models so the model build ignores it.
//
// Faust has no way to solve for a force and the motion it causes within the
// same sample: every feedback loop (~) carries one sample of delay. So the
// natural formulation is explicit: this sample's forces are computed from
// last sample's positions. Here that is the symplectic Euler method,
//
//   v[n+1] = v[n] + T/m (F - k x[n] -/+ kc (xa[n] - xb[n]))
//   x[n+1] = x[n] + T v[n+1]
//
// which is stable only while every frequency of the system satisfies
// w T < 2 (about 15.3 kHz at 48 kHz).

mass  = hslider("mass[unit:kg]", 0.1, 0.001, 10, 0.001);
f0    = hslider("frequency[unit:Hz]", 440, 1, 30000, 0.01);
kc    = hslider("coupling[unit:N/m]", 0, 0, 1e9, 1);
// Impulse given to oscillator a on each strike (N s).
kick  = hslider("impulse", 1, 0, 100, 0.001);
strike = hslider("strike", 0, 0, 1000000, 1);

T = 1 / ma.SR;
k0 = mass * pow(2 * ma.PI * f0, 2);
trig = strike != strike';
// A one-sample force of impulse J has value J / T.
force = trig * kick / T;

step(xa, va, xb, vb, F) = xa2, va2, xb2, vb2
with {
    fc = kc * (xa - xb);
    va2 = va + T / mass * (F - k0 * xa - fc);
    vb2 = vb + T / mass * (0 - k0 * xb + fc);
    xa2 = xa + T * va2;
    xb2 = xb + T * vb2;
};

// Outputs: velocity of a, velocity of b.
process = force : (step ~ si.bus(4)) : !, _, !, _;
