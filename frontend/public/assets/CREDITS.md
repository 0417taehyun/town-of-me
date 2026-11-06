# Third-party assets

Every third-party file the app ships, relative to this folder. All of them are CC0 1.0, which allows copying,
changing, and redistributing them, including commercially, without attribution, except the two MediaPipe models and the
Pretendard font: the models are Apache-2.0, which allows the same as long as the license text goes with them, and the
font is under the SIL Open Font License 1.1, which allows the same with its copyright notice and license, short of
selling the font by itself. Each is credited here for provenance. Everything else the town draws or plays (characters,
buildings, trees, flowers, birds, music, and voices) is original procedural work in this repository.

| Path                                   | Title                                                | Author        | Source                                                                                                                   | License                                                       | Changes                                                                                          |
| -------------------------------------- | ---------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `kenney/nature/crop_pumpkin.glb`       | Nature Kit 2.1: `crop_pumpkin`                       | Kenney        | https://kenney.nl/assets/nature-kit                                                                                      | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | None to the file. In the app its materials are made non-metallic and tinted by the object color. |
| `kenney/nature/mushroom_redGroup.glb`  | Nature Kit 2.1: `mushroom_redGroup`                  | Kenney        | https://kenney.nl/assets/nature-kit                                                                                      | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | None to the file. In the app its materials are made non-metallic and tinted by the object color. |
| `kenney/nature/plant_bushDetailed.glb` | Nature Kit 2.1: `plant_bushDetailed`                 | Kenney        | https://kenney.nl/assets/nature-kit                                                                                      | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | None to the file. In the app its materials are made non-metallic and tinted by the object color. |
| `kenney/nature/rock_smallE.glb`        | Nature Kit 2.1: `rock_smallE`                        | Kenney        | https://kenney.nl/assets/nature-kit                                                                                      | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | None to the file. In the app its materials are made non-metallic and tinted by the object color. |
| `audio/corgi-bark.mp3`                 | Single Dog Bark                                      | kwahmah_02    | https://freesound.org/people/kwahmah_02/sounds/277058/                                                                   | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Renamed from the high-quality MP3 preview; the app plays it quietly at slightly varied pitches.  |
| `models/pose_landmarker_lite.task`     | MediaPipe Pose Landmarker (Lite), float16            | Google        | https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task | [Apache-2.0](models/LICENSE.txt)                              | None. SHA-256 `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`.                |
| `models/efficientdet_lite0.tflite`     | MediaPipe Object Detector: EfficientDet-Lite0, int8  | Google        | https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite      | [Apache-2.0](models/LICENSE.txt)                              | None. SHA-256 `0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb`.                |
| `PretendardVariable.subset.*.woff2`    | Pretendard Variable 1.3.9, dynamic subset (92 files) | Kil Hyung-jin | https://github.com/orioncactus/pretendard/releases/tag/v1.3.9                                                            | [OFL-1.1](Pretendard-LICENSE.txt)                             | None. The build copies them from the `pretendard` package and adds a content hash to each name.  |

- **Kenney Nature Kit:** the pack's own license text is kept beside the models in
  [`kenney/nature/License.txt`](kenney/nature/License.txt).
- **Single Dog Bark:** a recording of an actual dog, not a synthesized effect, published on Freesound on June 21, 2015.
  The file is the preview at https://cdn.freesound.org/previews/277/277058_4486188-hq.mp3. Its license and source
  description were verified on October 4, 2026.
- **MediaPipe models:** the Apache-2.0 text is kept beside them in [`models/LICENSE.txt`](models/LICENSE.txt). The pose
  model's card (BlazePose GHUM 3D) names that license, and TensorFlow publishes EfficientDet-Lite0 under it; both were
  checked, and the files compared with a fresh download, on October 31, 2026. The app loads them from this origin. A
  model that changes gets a new file name.
- **Pretendard:** Copyright (c) 2021, Kil Hyung-jin (https://github.com/orioncactus/pretendard), with Reserved Font
  Name 'Pretendard'. [`Pretendard-LICENSE.txt`](Pretendard-LICENSE.txt) keeps the license text with that notice and
  those of the fonts Pretendard is built on (Inter, Adobe's Source Han Sans, and M PLUS 1p). It is the package's
  `dist/LICENSE.txt` as upstream completed it after 1.3.9 (commit `0189074`, orioncactus/pretendard#192); the 1.3.9
  copy names only Kil Hyung-jin. Each font file also carries its copyright and license in its own metadata.
  `frontend/src/main.tsx` imports the package's `dist/web/variable/pretendardvariable-dynamic-subset.css`, so a page
  loads, from this origin, only the files whose `unicode-range` its text needs. The version and license were checked
  against the npm registry and the v1.3.9 GitHub release on October 31, 2026.

Add a row here for every third-party file added to `public/`, and for every font or media file bundled from a package.
