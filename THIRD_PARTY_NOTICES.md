# Third-party notices

Flesh of the Ancients ships two third-party JavaScript libraries, vendored under `vendor/`. They are byte-identical to the published npm builds (SHA-256 checked), except for a licence header comment added at the top of `three-mesh-bvh.module.js`. Both are under the MIT License; full texts are in
`licenses/`.

| File | Library | Version | Author / copyright | Licence | Source |
|---|---|---|---|---|---|
| `vendor/three.module.min.js` | three.js (`build/three.module.min.js`) | r170 (npm `three@0.170.0`) | Copyright © 2010-2024 three.js authors | MIT ([text](licenses/three.js-LICENSE.txt)) | https://github.com/mrdoob/three.js · https://threejs.org/ |
| `vendor/three-mesh-bvh.module.js` | three-mesh-bvh (`build/index.module.js`) | 0.8.3 (npm `three-mesh-bvh@0.8.3`) | Copyright (c) 2018 Garrett Johnson (gkjohnson) | MIT ([text](licenses/three-mesh-bvh-LICENSE.txt)) | https://github.com/gkjohnson/three-mesh-bvh |

three-mesh-bvh is used for mesh-accurate cave wall collision and the chase camera's wall test (`js/wallcollide.js`, `js/main.js`).

## Other content

- **Textures, models, sound and music:** all procedural, generated in the browser by this game's own code (`js/mesh.js`,
  `js/audio.js`, etc.). No third-party image, model, sound or font files are bundled.
- **Fonts:** system font stack only (Palatino Linotype / Palatino / Georgia / Times); nothing is embedded.
- **Carlsbad Cavern mode (`data/carlsbad.json`):** an approximate layout traced by hand from public U.S. National Park
  Service maps, used as reference only (not survey data):
  - https://www.nps.gov/cave/planyourvisit/upload/Accessibility_WO-Loop-Road.pdf
  - https://www.nps.gov/cave/planyourvisit/selfguided_tours.htm
  - https://www.nps.gov/cave/learn/upload/Cavern-Trails-and-Tours.pdf
  - https://npmaps.com/wp-content/uploads/carlsbad-caverns-interior-map.pdf

  Carlsbad Caverns National Park and its place / formation names belong to the real park; this game is not affiliated
  with or endorsed by the National Park Service.
