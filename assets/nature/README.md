# Nature assets (glTF)

Trees, bushes and rocks used by Island Builder's place palette.

- **Source:** KayKit "Medieval Hexagon Pack" (1.0), the *decoration/nature*
  models, by Kay Lousberg — <https://www.kaylousberg.com> /
  <https://kaylousberg.itch.io/>. Mirrored on GitHub at
  <https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0>.
- **License:** CC0 1.0 (public domain). See `LICENSE.txt`. Crediting Kay
  Lousberg is appreciated but not required.

## Why this pack (mobile memory)

Every model in the pack shares **one** texture atlas
(`hexagons_medieval.png`, ~15 KB, 1024²) and each model is a **single mesh**.
That means all tree/rock variants render with **one shared material** and each
variant is one `InstancedMesh` (1 draw call), with a single texture on the GPU
— ideal for low-end phones.

## Structure

```
assets/nature/glTF/
  *.gltf + *.bin        … individual models (tree_single_*, trees_A_*, rock_single_*)
  hexagons_medieval.png … the shared atlas referenced by every .gltf (bare name)
```

Files are kept flat and the `.gltf` reference their `.bin` and the atlas by
bare same-folder filenames, so the folder must stay together. Paths are
relative, so it works under the GitHub Pages subfolder.

Only a curated subset of the pack is vendored/loaded (a few trees, a bush and a
few rocks) to keep what's loaded at runtime small.
