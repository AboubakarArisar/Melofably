declare name "bar";
declare description "Struck free-free metal bars: modal synthesis from Euler-Bernoulli beam theory";

import("stdfaust.lib");
import("modal.lib");

// A set of 25 uniform rectangular bars (two octaves, like a metallophone),
// each a bank of damped two-pole resonators, one per bending mode, driven by
// a short force pulse from a mallet. Equations, assumptions and limits are in
// docs/BAR_MODEL.md.

NBARS = 25;  // one bar per key; each rings independently
NMODES = 8;  // bending modes per bar

// ---- controls -------------------------------------------------------------
// All clamped inside the DSP so no host value can produce an invalid model.
len   = hslider("length[unit:m]", 0.3, 0.1, 0.6, 0.001)          : clip(0.1, 0.6);
thick = hslider("thickness[unit:mm]", 10, 3, 30, 0.1)            : clip(3, 30) : *(0.001);
dens  = hslider("density[unit:kg/m3]", 2700, 1500, 9000, 10)     : clip(1500, 9000);
young = hslider("youngsModulus[unit:GPa]", 70, 20, 220, 1)       : clip(20, 220) : *(1e9);
loss  = hslider("lossFactor", 0.001, 0.0001, 0.01, 0.0001)       : clip(0.0001, 0.01);
pos   = hslider("strikePosition", 0.35, 0, 0.5, 0.001)           : clip(0, 0.5);
hard  = hslider("hardness", 0.6, 0, 1, 0.001)                    : clip(0, 1);
vel   = hslider("velocity", 0.8, 0, 1, 0.001)                    : clip(0, 1);
// Which bar to strike: bar i is cut shorter so it sounds i semitones higher.
key   = hslider("key", 0, 0, 24, 1)                              : clip(0, 24);
// Strike trigger: the host increments this; any change strikes bar `key`.
strike = hslider("strike", 0, 0, 1000000, 1);

// ---- beam physics ---------------------------------------------------------
// Transverse (bending) vibration of a uniform Euler-Bernoulli beam with both
// ends free. The frequency equation is cos(k) cosh(k) = 1; its roots k_n are:
kList = (4.730040744863, 7.853204624096, 10.99560783800, 14.13716549126,
         17.27875965740, 20.42035224563, 23.56194490204, 26.70353755551);
k(n) = ba.take(n + 1, kList);
// Mode n has frequency
//   f_n = k_n^2 / (2 pi L^2) * sqrt(E I / (rho A)),
// and for a rectangular section of thickness h, I / A = h^2 / 12, so
//   f_n = k_n^2 * h / (2 pi L^2) * sqrt(E / (12 rho)).
// The width cancels. The modes are inharmonic: f_n / f_1 = (k_n / k_1)^2
// = 1, 2.757, 5.404, 8.933, 13.34, 18.64, 24.81, 31.87.
stiffness = thick * sqrt(young / (12 * dens)) / (2 * ma.PI);
// Frequency goes as 1 / L^2, so one semitone up is a bar shorter by 2^(1/24).
barLength(i) = len * pow(2, 0 - i / 24);
freq(i, n) = k(n) * k(n) * stiffness / (barLength(i) * barLength(i));
// A resonator cannot be tuned above Nyquist; such modes are switched off.
audible(i, n) = freq(i, n) < 0.45 * ma.SR;

// Mode shape of mode n at x = xi * L (xi = 0 is an end, 0.5 the middle):
//   phi(xi) = cosh(k xi) + cos(k xi) - sigma (sinh(k xi) + sin(k xi)),
//   sigma = (cosh k - cos k) / (sinh k - sin k),
// normalised so its mean square over the bar is 1 (phi = 2 at a free end).
// Written with exponentials so the large cosh/sinh terms never cancel in
// single precision: with c = (1 - sigma) / 2,
//   phi = cos(k xi) - sigma sin(k xi) + (1 - c) e^(-k xi) + c e^(k xi).
cList = (8.74889271e-3, 0 - 3.88655954e-4, 1.67749373e-5, 0 - 7.24948828e-7,
         3.13278083e-8, 0 - 1.35379748e-9, 5.85028935e-11, 0 - 2.52813926e-12);
c(n) = ba.take(n + 1, cList);
shape(n, xi) = cos(k(n) * xi) - (1 - 2 * c(n)) * sin(k(n) * xi)
             + (1 - c(n)) * exp(0 - k(n) * xi) + c(n) * exp(k(n) * xi);
// A force at xi drives mode n in proportion to phi_n(xi), and the bar's
// velocity at that same point contains mode n in proportion to phi_n(xi)
// again. The output is that driving-point velocity, so each mode's weight is
// phi_n(xi)^2: zero when the mallet lands on a node of the mode.
weight(n) = shape(n, pos) * shape(n, pos);
// Level normalisation (a loudness choice, not physics): each bar's weights are
// divided by their root-sum-square over the modes that bar can sound. The
// relative levels of a bar's modes, i.e. its timbre, are untouched. What is
// removed is the large change in overall level with strike position (the raw
// driving-point response is four times larger at a free end than at a typical
// interior point) and the penalty short bars would pay for modes that lie
// above the audio band.
norm(i) = sqrt(sum(n, NMODES, weight(n) * weight(n) * audible(i, n))) : max(0.001);
modeGain(i, n) = weight(n) * audible(i, n) / norm(i);

// ---- damping --------------------------------------------------------------
// Internal (material) damping with loss factor eta removes a fixed fraction
// of a mode's energy per cycle, so its decay rate is eta * pi * f per second
// and its 60 dB decay time is ln(1000) / (eta pi f) = 2.2 / (eta f): higher
// modes die faster. A fixed 6 s term stands for losses to the supports and
// the air, which otherwise make a low-loss bar ring unrealistically long.
T60_MOUNT = 6;
t60(i, n) = 1 / (1 / T60_MOUNT + loss * freq(i, n) / 2.2);

// ---- excitation -----------------------------------------------------------
// The mallet applies a half-sine force pulse. Its duration is the contact
// time: 1.2 ms for a soft mallet down to 0.15 ms for a hard one, shortening
// slightly for faster strikes (Hertzian contact: time ~ velocity^(-1/5)). The
// pulse area (the impulse delivered) is proportional to strike velocity, so a
// longer contact is the same push spread out, with less high-frequency force.
contact = 0.0012 * pow(0.15 / 1.2, hard) * pow(max(vel, 0.05), 0 - 0.2);
trig = strike != strike';
force = strikeForce(trig, contact, vel);
// There is one mallet: the pulse goes to the bar that was selected when it
// struck. (A second strike within the ~1 ms contact time cuts the first short.)
target = key : ba.sAndH(trig);
pulse(i) = force * (target == i);

// ---- resonators -----------------------------------------------------------
// One two-pole resonator per mode: poles at radius r = e^(-ln(1000) / (t60 SR))
// and angle w = 2 pi f / SR, zeros at DC and Nyquist (the same filter as
// Faust's pm.modeFilter). r is below 1 for every finite t60, so each mode is
// unconditionally stable, and its response to an impulse has the same peak
// height at every frequency.
//
// The 200 resonators' coefficients are recomputed every audio block. Library
// cos/pow calls dominated the CPU cost, so `resonator` (modal.lib) evaluates
// both as polynomials: sin by its Taylor series to x^13 (error below 2e-10)
// and e^(-x) to x^3 (x is at most 0.016 here; error below 3e-9).
mode(i, n) = resonator(min(freq(i, n), 0.45 * ma.SR), t60(i, n), modeGain(i, n));
bar(i) = pulse(i) <: par(n, NMODES, mode(i, n)) :> _;

// ---- output ---------------------------------------------------------------
// softLimit (modal.lib) is transparent below 0.8, then a smooth knee that
// approaches but never reaches 1: several bars ringing together cannot clip.
// Gain chosen so the hardest single strike (hard mallet, full velocity, on the
// end of the longest bar) peaks near 0.5 and a typical one near 0.2, leaving
// room for several bars to ring together below the limiter's knee.
process = par(i, NBARS, bar(i)) :> *(0.2) : softLimit;
