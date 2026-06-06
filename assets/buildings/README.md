# Medieval Village MegaKit (glTF) — building assets

These are 3D building assets used by Island Builder.

- **Source:** Quaternius "Medieval Village MegaKit" (FREE / standard version),
  the glTF distribution mirrored at
  <https://github.com/J-Ponzo/gltf-medieval-village-megakit>
  (originally from <https://quaternius.itch.io/medieval-village-megakit>).
- **License:** CC0 1.0 Universal (public domain). See `LICENSE`.
- **Author:** Quaternius (@quaternius).

## Structure

```
assets/buildings/
  glTF/        … 176 models as .gltf + .bin pairs, PLUS the shared
                 textures (.png) co-located in the same folder
  LICENSE      … CC0 1.0
```

Note: in this FREE glTF distribution the textures are **co-located inside the
`glTF/` folder** (there is no separate `Textures/` folder). Each `.gltf`
references its `.bin` and texture `.png` files by bare, same-folder filenames,
so the folder must be kept together for the models to load correctly.

## Loading (three.js)

Load a model with `GLTFLoader`, pointing at the `.gltf`; the loader resolves
the `.bin` and textures relative to it:

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
new GLTFLoader().load('./assets/buildings/glTF/House_1.gltf', (gltf) => {
  scene.add(gltf.scene);
});
```

Paths are relative so this works under the GitHub Pages subfolder
(`/island-builder/`).
