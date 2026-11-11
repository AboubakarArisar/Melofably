# audio/models

Physical instrument models as Faust source (`.dsp`), one file per model
(string, bar, plate, ...). This is the only place sound is defined. Every model
must be a genuine physical model (waveguide, modal, mass-spring); no samples,
no wavetables.
