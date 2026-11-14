# Running the tests

```
npm test
```

runs every test file (`tests/**/*.test.ts`) with the configuration in
`vite.config.ts`. Since Phase 3C.3 that configuration is:

| Setting | Value | Why |
| --- | --- | --- |
| `maxWorkers` | 3 | Many files render minutes of audio. One file per processor thread (the default, 12 on the development machine) makes each several times slower and makes timing depend on what else is running. |
| `testTimeout` | 180 s | The slowest tests (stability sweeps of the string prototypes) take about 30 s on an idle machine and were measured at 65 to 75 s under the conditions below. The earlier limit of 60 s failed them for being slow. |

Neither changes an expected value. No numerical assertion was altered to
make a test pass.

## Machine conditions these were measured under

Development machine: AMD Ryzen 5 7430U (6 cores, 12 threads), 15 GB RAM,
Windows 11, Node 24.14.0. During Phases 3C.2.3 and 3C.3 it was **on battery
for most runs, with another program of the user's using between 25 and 90 %
of the processor**. Under those conditions:

- with the old configuration, one or two tests failed in most full runs: a
  60 s timeout in `tests/coupled-string.test.ts` or
  `tests/soundboard.test.ts`, or the test described below;
- on mains power with the machine otherwise idle (Phase 3C.2.2), the same
  suite passed with the old configuration.

A full run takes 2.5 to 3 minutes with three workers, about 9 minutes with
one (`npx vitest run --no-file-parallelism`).

## One test that is not deterministic

`tests/experimental.test.ts`, "edits are plain parameter writes: nothing is
rebuilt, and nothing is allocated while running" (Phase 3A).

It runs the TypeScript reference engine (not the WebAssembly engine, and not
anything the application uses) for three million samples and asserts that
the JavaScript garbage collector did not run **once** in that time, as
evidence that the engine allocates nothing per sample.

What was found in Phase 3C.3, with the test unchanged:

- Counting collections in chunks of 2000 blocks shows two during the first
  chunk (the just-in-time compiler warming up, which the test allows for
  with 4000 blocks of warm-up) and then none, in most runs.
- In some runs a pair of collections appears much later (once at blocks
  28 000 to 30 000), inside the counted window. The reference engine did not
  start allocating: V8 de-optimised a function and ran it un-optimised,
  which does allocate, until it was compiled again.
- How often this happens varied from none in six runs to two in three, on
  the same code, minutes apart. Running the file alone, in parallel, or with
  eight busy processes alongside did not settle it either way. It could not
  be made to fail or to pass on demand.

So the assertion is stricter than the property it is evidence for, and it
fails now and then for a reason that is not a defect of the engine. It has
been **left exactly as it is**: it is not retried, skipped or loosened. When
it fails, the message is `expected N to be +0` with N from 2 to 4. To check
it alone:

```
npx vitest run tests/experimental.test.ts -t "nothing is allocated"
```

A deterministic replacement would measure allocation directly instead of
counting collections. That is a change to an approved Phase 3A test and has
not been made.

## Phase 3D.1

With the configuration above, on mains power and the machine at 20 to 35 %
load, the full suite (265 tests in 17 files) passed in each of the three
complete runs made, in 80 to 86 s. The test of the previous section did not
fail in any of them, and was not changed.

## What a failure means

- `Test timed out in 180000ms`: the machine was too busy even for the longer
  limit. Run that file alone.
- `expected N to be +0` in the test above: see the previous section.
- Anything else is a real failure.

## Phase 3D.2

The same configuration. The suite is 282 tests in 18 files. The runs made are recorded in the phase's report; the test described under "One test that is not deterministic" was not changed.


## Phase 3D.3

The same configuration. The suite is 293 tests in 19 files. The runs made are recorded in the phase's report; the test described under "One test that is not deterministic" was not changed.


## Phase 3D.4

The same configuration. The suite is 315 tests in 20 files. `tests/radiator.test.ts` runs the earlier examples on the engine binary of Phase 3D.3 as well, kept at `tests/fixtures/engine-phase-3d3.wasm`: do not regenerate that file. The runs made are recorded in the phase's report; the test described under "One test that is not deterministic" was not changed.

## Phase 3D.5

The same configuration. The suite is 330 tests in 21 files. The runs made are recorded in the phase's report; the test described under "One test that is not deterministic" was not changed.

## Phase 3D.5.1

The same configuration. The suite is 337 tests in 22 files. The runs made are recorded in the phase's report; the test described under "One test that is not deterministic" was not changed.
