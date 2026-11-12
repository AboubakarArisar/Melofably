declare name "wood";
declare description "Struck free-free wooden bars over tube resonators: modal synthesis from Euler-Bernoulli beam theory";

import("stdfaust.lib");
import("modal.lib");

// A set of 25 uniform rectangular wooden bars (two octaves, like a
// xylophone), each a bank of damped two-pole resonators, one per bending
// mode, driven by a short force pulse from a mallet, with a tube resonator
// under each bar. Equations, sources, assumptions and limits are in
// docs/WOOD_MODEL.md.
//
// The beam equation and mode shapes are the same as the metal bar's: a
// uniform bar has the same bending-mode ratios whatever it is made of. What
// makes this wood is the material (light and far less stiff), the damping law
// (losses rising with the square of frequency), the mallet (a lossy contact)
// and the resonator tubes.

NBARS = 25;  // one bar per key; each rings independently
NMODES = 6;  // bending modes per bar; higher ones die within milliseconds

// ---- controls -------------------------------------------------------------
// All clamped inside the DSP so no host value can produce an invalid model.
len   = hslider("length[unit:m]", 0.38, 0.15, 0.6, 0.001)        : clip(0.15, 0.6);
thick = hslider("thickness[unit:mm]", 19, 8, 30, 0.1)            : clip(8, 30) : *(0.001);
dens  = hslider("density[unit:kg/m3]", 950, 400, 1300, 10)       : clip(400, 1300);
// Along the grain, which runs the length of the bar.
young = hslider("youngsModulus[unit:GPa]", 18, 6, 25, 0.1)       : clip(6, 25) : *(1e9);
// Loss factor of the wood at 1 kHz.
loss  = hslider("lossFactor", 0.006, 0.001, 0.03, 0.0005)        : clip(0.001, 0.03);
pos   = hslider("strikePosition", 0.45, 0, 0.5, 0.001)           : clip(0, 0.5);
hard  = hslider("hardness", 0.7, 0, 1, 0.001)                    : clip(0, 1);
vel   = hslider("velocity", 0.8, 0, 1, 0.001)                    : clip(0, 1);
// How strongly each bar's tube resonator is coupled in (0 = bare bars).
tube  = hslider("resonator", 0.35, 0, 1, 0.001)                  : clip(0, 1);
// Which bar to strike: bar i is cut shorter so it sounds i semitones higher.
key   = hslider("key", 0, 0, 24, 1)                              : clip(0, 24);
// Strike trigger: the host increments this; any change strikes bar `key`.
strike = hslider("strike", 0, 0, 1000000, 1);

// ---- beam physics ---------------------------------------------------------
// Transverse (bending) vibration of a uniform Euler-Bernoulli beam with both
// ends free. Roots k_n of cos(k) cosh(k) = 1:
kList = (4.730040744863, 7.853204624096, 10.99560783800, 14.13716549126,
         17.27875965740, 20.42035224563);
k(n) = ba.take(n + 1, kList);
// f_n = k_n^2 * h / (2 pi L^2) * sqrt(E / (12 rho)) for thickness h, with E
// the modulus along the grain. f_n / f_1 = 1, 2.757, 5.404, 8.933, 13.34, 18.64.
stiffness = thick * sqrt(young / (12 * dens)) / (2 * ma.PI);
// Frequency goes as 1 / L^2, so one semitone up is a bar shorter by 2^(1/24).
barLength(i) = len * pow(2, 0 - i / 24);
freq(i, n) = k(n) * k(n) * stiffness / (barLength(i) * barLength(i));
// A resonator cannot be tuned above Nyquist; such modes are switched off.
audible(i, n) = freq(i, n) < 0.45 * ma.SR;

// Mode shape of mode n at x = xi * L (xi = 0 is an end, 0.5 the middle), in
// the cancellation-free form phi = cos(k xi) - sigma sin(k xi)
// + (1 - c) e^(-k xi) + c e^(k xi), with c = (1 - sigma) / 2.
cList = (8.74889271e-3, 0 - 3.88655954e-4, 1.67749373e-5, 0 - 7.24948828e-7,
         3.13278083e-8, 0 - 1.35379748e-9);
c(n) = ba.take(n + 1, cList);
shape(n, xi) = cos(k(n) * xi) - (1 - 2 * c(n)) * sin(k(n) * xi)
             + (1 - c(n)) * exp(0 - k(n) * xi) + c(n) * exp(k(n) * xi);
// Driving-point response: a force at xi drives mode n in proportion to
// phi_n(xi), and the bar's velocity there contains it in proportion to
// phi_n(xi) again, so each mode's weight is phi_n(xi)^2.
weight(n) = shape(n, pos) * shape(n, pos);
// Level normalisation (a loudness choice, not physics): each bar's weights
// are divided by their root-sum-square over the modes that bar can sound.
// A bar's timbre is untouched; its level no longer swings with strike position.
norm(i) = sqrt(sum(n, NMODES, weight(n) * weight(n) * audible(i, n))) : max(0.001);
modeGain(i, n) = weight(n) * audible(i, n) / norm(i);

// ---- damping --------------------------------------------------------------
// Chaigne & Doutaut's xylophone model damps the bar with two terms: one
// independent of frequency (air and supports) and a viscoelastic one whose
// decay rate rises with the square of frequency. As a 60 dB decay time:
//   1 / T60 = 1 / T_AIR + eta_1k * f^2 / 2200,
// where eta_1k is the wood's loss factor at 1 kHz (a viscoelastic material's
// loss factor is proportional to frequency: eta(f) = eta_1k * f / 1000, and
// T60 = 2.2 / (eta(f) f)). The constant term dominates low bars; the squared
// term makes the upper modes vanish within a few cycles.
T_AIR = 0.7;
t60(i, n) = 1 / (1 / T_AIR + loss * freq(i, n) * freq(i, n) / 2200);

// ---- excitation -----------------------------------------------------------
// Xylophone mallets (yarn, rubber, soft wood) are lossy: the head compresses
// and recovers without bouncing. The contact is modelled as a critically
// damped mass on a spring, whose force is F(t) ~ t e^(-t / tc): a quick rise
// to a peak at t = tc, then a slower release. (The metal bar and glass use an
// elastic, lossless contact, a half-sine.) An impulse through two identical
// one-pole lowpasses of time constant tc produces exactly this pulse, with
// area equal to the impulse, here the strike velocity.
//
// Its spectrum is 1 / (1 + (2 pi f tc)^2): flat up to 1 / (2 pi tc), then
// falling 12 dB per octave, with no nulls. The contact lasts about 4 tc:
// 2 ms for a soft mallet down to 0.2 ms for a hard one, shortening slightly
// for faster strikes (Hertzian contact: time ~ velocity^(-1/5)).
contact = 0.002 * pow(0.2 / 2, hard) * pow(max(vel, 0.05), 0 - 0.2);
tc = contact / 4;
lossy = si.smooth(exp(0 - 1 / (tc * ma.SR)));
trig = strike != strike';
force = trig * vel : lossy : lossy;
// There is one mallet: the pulse goes to the bar selected when it struck.
target = key : ba.sAndH(trig);
pulse(i) = force * (target == i);

// Keyboard level compensation (a loudness choice, not physics). The same
// mallet delivers less force at a short bar's higher frequencies, so left
// alone the top of the keyboard would be far quieter than the bottom. Each
// bar is boosted by exactly the amount its fundamental loses to the mallet
// spectrum relative to the lowest bar's, up to 24 dB. This plays the part of
// the harder mallets and firmer strokes a player uses on the upper bars. It
// scales a whole bar and does not alter its timbre.
rolloff(f) = 1 + pow(2 * ma.PI * f * tc, 2);
barLevel(i) = rolloff(freq(i, 0)) / rolloff(freq(0, 0)) : clip(1, 16);

// ---- bars and resonator tubes ------------------------------------------------
mode(i, n) = resonator(min(freq(i, n), 0.45 * ma.SR), t60(i, n), modeGain(i, n));
// Under each bar hangs a tube closed at the bottom, tuned to the bar's
// fundamental. The air in it resonates with that mode, radiating it more
// efficiently and adding a short bloom after the attack. Modelled as one
// more two-pole resonator at the fundamental, fed by the bar and added to
// it, with a quality factor of 10 (decay 2.2 Q / f seconds). Its peak gain is
// TUBE_GAIN * `resonator`. Only the tube's first resonance is included.
TUBE_Q = 10;
TUBE_GAIN = 2.5;
tubeDecay(i) = 2.2 * TUBE_Q / freq(i, 0);
tubeResonator(i) = resonator(min(freq(i, 0), 0.45 * ma.SR), tubeDecay(i),
                             tube * TUBE_GAIN * poleGap(tubeDecay(i)) * audible(i, 0));
bar(i) = pulse(i) * barLevel(i) <: par(n, NMODES, mode(i, n)) :> _ <: _, tubeResonator(i) :> _;

// ---- output ---------------------------------------------------------------
// Gain chosen so the hardest single strike, with the tubes fully coupled,
// peaks near 0.6 and a typical one near 0.25.
process = par(i, NBARS, bar(i)) :> *(0.12) : softLimit;
