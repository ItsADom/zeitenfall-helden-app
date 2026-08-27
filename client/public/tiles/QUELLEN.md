# Kachel-Texturen — Herkunft und Lizenz

Alle Dateien hier sind **CC0** (Public Domain). Eine Namensnennung ist damit
nicht verpflichtend — sie steht trotzdem hier, damit später nachvollziehbar
bleibt, woher eine Kachel stammt und wo eine bessere zu finden wäre.

Verarbeitung: Diffuse-/Color-Map in 1K geladen, auf **256×256 JPEG (q82)**
heruntergerechnet, Kanten dabei umlaufend abgetastet (`WrapMode.Tile`), damit
die Kachelbarkeit das Verkleinern überlebt. Gesamtgröße des Satzes: ~184 KB.

| Datei | Material | Herkunft | Asset |
|---|---|---|---|
| `sand.jpg` | Sand | Poly Haven | `sand_01` |
| `erde.jpg` | Erde | Poly Haven | `brown_mud` |
| `gras.jpg` | Gras | Poly Haven | `leafy_grass` |
| `moos.jpg` | Waldboden | Poly Haven | `forrest_ground_01` |
| `schnee.jpg` | Schnee | Poly Haven | `snow_02` |
| `fels.jpg` | Fels | Poly Haven | `rocky_terrain` |
| `steinboden.jpg` | Steinboden | Poly Haven | `cobblestone_floor_04` |
| `fliesen.jpg` | Fliesen | Poly Haven | `floor_tiles_06` |
| `ziegel.jpg` | Ziegel | Poly Haven | `brick_wall_001` |
| `holzdielen.jpg` | Holzdielen | Poly Haven | `oak_wood_planks` |
| `bretter.jpg` | Bretter | Poly Haven | `dark_planks` |
| `teppich.jpg` | Teppich | Poly Haven | `dirty_carpet` |
| `lava.jpg` | Lava | ambientCG | `Lava004` |

Poly Haven: <https://polyhaven.com/textures> · ambientCG: <https://ambientcg.com>

## Nicht fotografiert: Wasser

`wasser-tief` und `wasser-seicht` werden **erzeugt**, nicht geladen. In den
CC0-Bibliotheken gibt es keine brauchbare Wasseroberfläche von oben (die Suche
nach „water" liefert Eis und Verschmutzungen), und ein Foto stehenden Wassers
kachelt sichtbar schlecht — die Wiederholung fällt bei einer strukturlosen
Fläche besonders auf. Die erzeugte Welle ist dagegen von Bauart nahtlos und
kostet keine Datei.
