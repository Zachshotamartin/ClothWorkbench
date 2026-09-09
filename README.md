# Cloth Workbench

A real-time cloth experiment with an editable triangle budget, material presets, surface grabs, attachments and OBJ export. Start with a flat sheet above a ball, then let the constrained mesh form its own folds. The standalone app and portfolio import the same `src/index.js`.

[Open the portfolio demo](https://zachsm.com/experiments/cloth-workbench)

## Run

Requires Node.js 22 or later. The shared GraphicsWorkbench runtime is pinned in the lockfile.

```sh
npm ci
npm run dev
npm test
npm run build
```

The build produces a static site in `dist`. Processing, pointer interaction and exports stay in the browser. This repository has no GitHub Actions.

## Controls

- **Drop onto ball** resets the sheet to a horizontal plane above the sphere, clears attachments and previous velocity, then runs the simulation. It is an actual drop, not an animation clip.
- **Reset cloth** restores that clean setup and pauses. Changing **Triangles** also recreates the simulation and mesh from a clean state.
- Four budgets create **512**, **1,152**, **2,048** or **3,200** actual triangles. The quick tier is the default for narrow or coarse-pointer screens; desktop starts at 1,152. The OBJ export contains exactly the selected topology.
- **Silk**, **Linen** and **Canvas** change stretch, shear, bending compliance, drag and contact friction. The procedural woven material changes with the preset too. **Wind strength** and **Gravity** modify the forces used by the solver.
- Grab the cloth and pull. The target approaches at a bounded rate; pointer events never teleport a particle across the scene. The simulation advances while holding a grab, even if paused, and returns to its previous playing state on release.
- Choose an attachment arrangement or enable **Edit pins by clicking cloth**. The row/column controls provide a keyboard alternative. **Undo pin edit** restores the prior attachment positions.
- Pause, step exactly one display frame, inspect the mesh in wireframe, or **Freeze & export cloth OBJ**. Inactive tool switches release a grab and pointer capture while the shared runtime preserves the drape.

There is no decorative stand or crate intersecting the sheet. The sphere and tabletop match the collision shapes. Every visit starts paused, including reduced-motion mode; motion begins through an explicit action.

## Solver

`src/simulation.js` exports `ClothSimulation`, `MATERIALS` and `RESOLUTIONS`.

The solver uses a fixed **1/120-second** step with at most four substeps per display frame. A stalled frame cannot inject a huge timestep. Structural and diagonal constraints resist stretching and shearing; two-hop distance constraints approximate bending. Each substep initializes the constraint multipliers once, then accumulates them across eight alternating solver sweeps. Compliance enters the XPBD update as `alpha / h²`. Material values are tuned for this bounded experiment rather than calibrated from fabric measurements.

The elastic update follows [Macklin, Müller and Chentanez, XPBD (2016)](https://matthias-research.github.io/pages/publications/XPBD.pdf). A separate maximum-extension inequality limits extreme pulls. Prediction also caps displacement relative to the grid spacing, so rapid input cannot overwhelm the contact solve.

### Contact and folding

A spatial hash finds close particles without an all-pairs search. Particles in the same immediate mesh neighborhood are excluded; particles from different parts of the sheet are separated according to their inverse masses. Contact normals use position history for coincident particles, avoiding random impulses. This is active during constraint iterations, including ordinary ball drops—not just a diagnostic overlay. The approach is related to the particle-contact strategy demonstrated in [Matthias Müller's cloth self-collision example](https://matthias-research.github.io/pages/tenMinutePhysics/15-selfCollision.html).

Sphere and floor contacts are projected each solver pass. A resolution-dependent sphere allowance covers the chord between contact vertices, so a triangle facet does not visibly cut through the ball between its particles. Positional contact friction prevents a resting drape from slowly creeping off the sphere. There are no hidden pins holding the center of the sheet.

## Verification

`npm test` exercises:

- Twelve-second drops at low, balanced and highest resolution, checking finite coordinates, maximum structural strain, actual triangle-to-sphere distance, retained unpinned drape, settling movement and non-neighbor separation.
- A deliberately coincident pair of non-neighbor particles, proving the spatial-contact solver separates it.
- Actual OBJ vertex and face counts for all four resolution tiers.
- Reset and Drop clearing attachment, grab, velocity, timestep and constraint history.
- Large pointer targets and swept sphere clipping, material differences, fixed attachments and deterministic fixed-step accumulation.

Browser verification covers all four resolution selections, real Drop operations, parsed OBJ counts, clean Reset outputs, pointer interaction and mobile-width controls. These are numerical and interaction checks, not a claim of a production garment solver.

## Limits

Self-contact uses separated particles, **not continuous triangle–triangle or edge–edge collision detection**. Exceptionally tight folds can still overlap between particles, particularly at the lowest resolution. There is no tearing, sewing, shell-volume model or calibrated aerodynamic solver. Bending uses two-hop distances rather than a full shell constitutive model. Higher triangle budgets cost more CPU time; the quick tier deliberately trades fold detail for speed on small devices.

## Captured examples

![Coral silk cloth draped over a ball with stitched edges and broad folds](examples/01.png)

Silk, 1,152 triangles, unpinned drop onto the ball.

![Blue canvas draped over the sphere with stiffer folds, viewed from another angle](examples/02.png)

Canvas, 3,200 triangles, unpinned drop onto the same ball.

Both images are captured from the running editor. [The manifest](examples/manifest.json) records the controls and reproduction steps.
