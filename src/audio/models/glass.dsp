declare name "glass";
declare description "Struck thin-walled cylindrical glass vessels: modal synthesis from an inextensional shell approximation";

import("stdfaust.lib");

// A set of 25 thin-walled cylindrical glass vessels (like a row of tumblers),
// each closed and held rigid at its base and free at its rim, struck on the
// wall. Each vessel is a bank of damped two-pole resonators, one per wall
// vibration mode. Equations, sources, assumptions and limits are in
// docs/GLASS_MODEL.md.
//
// The mallet, resonator and limiter below are the same as in bar.dsp. They are
// repeated here rather than shared so that the approved bar model stays
// byte-for-byte untouched.

NVESSELS = 25; // one vessel per key; each rings independently
NMODES = 8;    // wall modes per vessel

clip(lo, hi) = max(lo) : min(hi);

// ---- controls -------------------------------------------------------------
// All clamped inside the DSP so no host value can produce an invalid model.
diam  = hslider("diameter[unit:mm]", 70, 40, 120, 0.5)          : clip(40, 120) : *(0.001);
tall  = hslider("height[unit:mm]", 90, 40, 200, 0.5)            : clip(40, 200) : *(0.001);
wall  = hslider("thickness[unit:mm]", 1.2, 0.5, 4, 0.05)        : clip(0.5, 4) : *(0.001);
dens  = hslider("density[unit:kg/m3]", 2500, 2200, 3200, 10)    : clip(2200, 3200);
young = hslider("youngsModulus[unit:GPa]", 70, 50, 90, 0.5)     : clip(50, 90) : *(1e9);
loss  = hslider("lossFactor", 0.0005, 0.0001, 0.005, 0.0001)    : clip(0.0001, 0.005);
// Where on the wall the vessel is struck: fraction of its height above the
// base (1 = the rim).
pos   = hslider("strikeHeight", 0.9, 0.05, 1, 0.001)            : clip(0.05, 1);
hard  = hslider("hardness", 0.6, 0, 1, 0.001)                   : clip(0, 1);
vel   = hslider("velocity", 0.8, 0, 1, 0.001)                   : clip(0, 1);
// Which vessel to strike: vessel i is the same shape scaled down so that it
// sounds i semitones higher (same wall thickness).
key   = hslider("key", 0, 0, 24, 1)                             : clip(0, 24);
// Strike trigger: the host increments this; any change strikes vessel `key`.
strike = hslider("strike", 0, 0, 1000000, 1);

// ---- shell physics --------------------------------------------------------
// Mode (n, m) of the wall has n nodal meridians' worth of lobes around the
// circumference (radial motion ~ cos(n theta), n >= 2) and m nodal circles
// along the height. Its frequency, for a cylinder of radius R, height H and
// wall thickness a bending without stretching (French 1983; Terwagne & Bush
// 2011, eq. 5):
//
//   f(n, m) = 1 / (12 pi) * sqrt(3 E / rho) * a / R^2
//             * sqrt( ((n^2 - 1)^2 + (b_m R / H)^4) / (1 + 1 / n^2) )
//
// The (n^2 - 1)^2 term is bending around the circumference (the classical
// inextensional ring); the (b_m R / H)^4 term is bending along the height.
// b_m is taken as the eigenvalue of a clamped-free beam with m nodes
// (1.8751, 4.6941), the wall's assumed shape along the height.
//
// Modes used, lowest first within each family:
//   (2,0) (3,0) (4,0) (5,0) (6,0)   and   (2,1) (3,1) (4,1)
nList = (2, 3, 4, 5, 6, 2, 3, 4);
bList = (1.875104068712, 1.875104068712, 1.875104068712, 1.875104068712, 1.875104068712,
         4.694091132974, 4.694091132974, 4.694091132974);
// sigma of the clamped-free beam shape, same order.
sList = (0.7340955137589, 0.7340955137589, 0.7340955137589, 0.7340955137589, 0.7340955137589,
         1.018467318759, 1.018467318759, 1.018467318759);
n(j) = ba.take(j + 1, nList);
b(j) = ba.take(j + 1, bList);
s(j) = ba.take(j + 1, sList);

radius = diam / 2;
// Depends on the vessel's proportions R / H but not on its size, so it is the
// same for every vessel in the set: this is what makes the overtone ratios
// change with the shape of the glass.
aspect = radius / tall;
modeFactor(j) = sqrt((pow(n(j) * n(j) - 1, 2) + pow(b(j) * aspect, 4)) / (1 + 1 / (n(j) * n(j))));
base = sqrt(3 * young / dens) / (12 * ma.PI) * wall / (radius * radius);
// Scaling R and H by 2^(-i/24) with the wall unchanged raises every mode by i
// semitones (frequency goes as 1 / R^2 at fixed R / H).
freq(i, j) = base * modeFactor(j) * pow(2, i / 12);
// A resonator cannot be tuned above Nyquist; such modes are switched off.
audible(i, j) = freq(i, j) < 0.45 * ma.SR;

// Shape of the wall's motion along the height at z = zeta * H (zeta = 0 is
// the base, 1 the rim): the clamped-free beam mode
//   Z(zeta) = cosh(b zeta) - cos(b zeta) - sigma (sinh(b zeta) - sin(b zeta)),
// normalised to unit mean square (|Z| = 2 at the rim). Around the
// circumference the vessel is symmetric, so every mode has an antinode
// wherever it is struck and the angle does not matter.
shape(j, zeta) = ma.cosh(b(j) * zeta) - cos(b(j) * zeta)
               - s(j) * (ma.sinh(b(j) * zeta) - sin(b(j) * zeta));
// A force at zeta drives mode j in proportion to Z_j(zeta), and the wall's
// velocity at that same point contains mode j in proportion to Z_j(zeta)
// again. The output is that driving-point velocity, so each mode's weight is
// Z_j(zeta)^2: zero when the strike lands on a nodal circle of the mode.
weight(j) = shape(j, pos) * shape(j, pos);
// Level normalisation (a loudness choice, not physics): each vessel's weights
// are divided by their root-sum-square over the modes that vessel can sound.
// The relative levels of a vessel's modes, i.e. its timbre, are untouched.
norm(i) = sqrt(sum(j, NMODES, weight(j) * weight(j) * audible(i, j))) : max(0.001);
modeGain(i, j) = weight(j) * audible(i, j) / norm(i);

// ---- damping --------------------------------------------------------------
// Internal (material) damping with loss factor eta removes a fixed fraction
// of a mode's energy per cycle, so its 60 dB decay time is 2.2 / (eta f):
// higher modes die faster. A fixed 8 s term stands for losses to whatever
// holds the vessel and to the air.
T60_MOUNT = 8;
t60(i, j) = 1 / (1 / T60_MOUNT + loss * freq(i, j) / 2.2);

// ---- excitation -----------------------------------------------------------
// The striker applies a half-sine force pulse. Its duration is the contact
// time: 1.2 ms for a soft striker down to 0.15 ms for a hard one, shortening
// slightly for faster strikes (Hertzian contact: time ~ velocity^(-1/5)). The
// pulse area (the impulse delivered) is proportional to strike velocity.
contact = 0.0012 * pow(0.15 / 1.2, hard) * pow(max(vel, 0.05), 0 - 0.2);
width = max(2, contact * ma.SR); // samples
trig = strike != strike';
sinceTrig = (+(1) : *(1 - trig) : min(1000000)) ~ _;
armed = max(trig) ~ _; // 0 until the first strike
force = armed * (sinceTrig < width)
      * sin(ma.PI * sinceTrig / width) * vel * ma.PI / (2 * width);
// There is one striker: the pulse goes to the vessel that was selected when
// it struck.
target = key : ba.sAndH(trig);
pulse(i) = force * (target == i);

// ---- resonators -----------------------------------------------------------
// One two-pole resonator per mode: poles at radius r = e^(-ln(1000) / (t60 SR))
// and angle w = 2 pi f / SR, zeros at DC and Nyquist. r is below 1 for every
// finite t60, so each mode is unconditionally stable.
//
// The 200 resonators' coefficients are recomputed every audio block, so cos
// and e^-x are evaluated as polynomials rather than library calls:
//  - sin(x) by its Taylor series to x^13, used as cos(w) = 1 - 2 sin^2(w / 2).
//    w / 2 never exceeds 1.42 rad, where the truncation error is below 2e-10.
//  - e^(-x) to x^3. x is at most 0.01 here (error below 1e-9).
sinPoly(x) = x * (1 + x2 * (0 - 1.0 / 6 + x2 * (1.0 / 120 + x2 * (0 - 1.0 / 5040
           + x2 * (1.0 / 362880 + x2 * (0 - 1.0 / 39916800 + x2 / 6227020800))))))
with { x2 = x * x; };
cosPoly(w) = 1 - 2 * q * q with { q = sinPoly(w / 2); };
expNeg(x) = 1 - x + x * x / 2 - x * x * x / 6;
resonator(f, decay, g) = fi.tf2(1, 0, 0 - 1, 0 - 2 * r * cosPoly(w), r * r) * g
with {
    w = 2 * ma.PI * f / ma.SR;
    r = expNeg(min(0.25, 6.9078 / (decay * ma.SR)));
};
mode(i, j) = resonator(min(freq(i, j), 0.45 * ma.SR), t60(i, j), modeGain(i, j));
vessel(i) = pulse(i) <: par(j, NMODES, mode(i, j)) :> _;

// ---- output ---------------------------------------------------------------
// Transparent below 0.8, then a smooth knee that approaches but never reaches
// 1 (same limiter as the other instruments).
knee = 0.8;
softLimit(x) = select2(abs(x) > knee, x,
    ma.signum(x) * (knee + (1 - knee) * ma.tanh((abs(x) - knee) / (1 - knee))));

// Gain chosen so the hardest single strike peaks near 0.5, leaving room for
// several vessels to ring together below the limiter's knee.
process = par(i, NVESSELS, vessel(i)) :> *(0.16) : softLimit;
