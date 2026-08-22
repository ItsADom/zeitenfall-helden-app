# 20+ Perk-Bäume — structured source data

Analysis of `20er_Baume.pdf` (Steven Ried, 19 slides, PowerPoint export), the
source for the `TODO.md` user-feedback bullet "20+ perk picker". This file holds
the **extracted and classified data**, not a build plan. Nothing here is
implemented.

Status: **[sketch]**. The rules below are confirmed by the developer; the data
still has open conflicts (see the last section) that block seeding a catalog,
because the perk name is the natural key and several names disagree between the
tree graphics and the description lists.

---

## Rules (confirmed)

The PDF's own three rules, plus what was clarified in the concept session:

1. **A tree belongs to an attribute.** Eight trees, one per attribute, each
   flavoured with a deity: MU→Rondra/Praios, KL→Hesinde/Tsa, IN→Firun,
   CH→Travia/Rahja, FF→Phex, GE→Efferd, KO→Peraine/Boron, KK→Ingerimm.
2. **At most two trees are ever live.** A player may have at most two attributes
   above 18 (temporary boni excepted), so at most two trees open.
3. **Columns are tiers gated by the attribute value**, not by talent values.
   The PDF says "nach min. HTAW sortiert" — this reads like a talent value at
   first, but it isn't: the GM's own house terminology calls attributes
   "Haupttalente" / "HTAW", a naming habit the playerbase itself finds
   confusing. The gate is the attribute (`akt`), never an actual talent's TaW.
   Tiers: 20+ (Reguläre), 28+ (Fortgeschrittene), 32+ (Meisterliche),
   34+ (Heldenhafte), 60 (Halbgöttliche).
4. **There are no prerequisite edges.** Despite the name "Bäume", the graphics
   contain no connecting lines. It is a tier grid, not a dependency graph. Every
   tree has the identical shape: **10 / 5 / 3 / 1 / 1** perks per tier.
5. **The pool is earned per attribute point above 20.** The 21st point in MU
   grants one perk point in the Mut tree. Pool size = `attribut − 20`.
6. **Points are spent, not banked into progress.** Points may accumulate, but a
   later column only opens once enough points have actually been *spent*.
   Hoarding never skips a tier.
7. **The player picks; unlocking a tier does not grant its contents.** A tier
   makes perks *available*; each one still costs from the pool.
8. **Each stage costs one point.** A perk has up to three stages; taking a perk
   to stage 3 costs three points in total.
9. **Stage values are absolute, not cumulative.** A perk listed as "20/30/40" is
   worth exactly **40** at stage 3, not 20+30+40. The app selects the value at
   the current stage, it does not sum the stages.
10. **Only the base attribute counts.** Trees read `akt`, never
    `attrMax = akt + mod`. A temporary buff neither widens the pool nor opens a
    column, so an expiring buff can never strand already-chosen perks.

11. **High tiers are hidden until reached.** Heldenhafte (34+) and halbgöttliche
    (60) Talente are not published in advance. The GM reveals one when a player
    actually reaches and picks it. See conflict section 9 — this makes a
    server-side reveal state part of the data model, not a content detail.

### Open rule question

Rule 6 needs a number. The formalization carried here as an **assumption, not a
confirmation**: column `T` opens when `attribut ≥ T` **and**
`ausgegebenePunkte ≥ T − 20`, since `T − 20` is exactly what a character has
earned by the time the attribute reaches `T`. This reads rule 6 as "you must
have spent everything you earned so far". Needs GM sign-off before it is built.

---

## Effect taxonomy

Derived bottom-up from all ~160 effect texts. The primary split is **what the
app has to do**, because that is what drives the data model.

A perk is **not one effect**. `Körperbau` grants Wundschwelle *and* MaxADP;
`Sternlesen` grants TaW *and* QS; `Bis zum Tod` grants Todesschwelle *and* a
rule statement. The model is therefore `Perk → Effekt[]`, mirroring the
multi-bonus decision already taken for items in
[`item-bonus-while-worn.md`](item-bonus-while-worn.md).

### Computed — the app applies the number

| Code | Meaning | Count |
|---|---|---|
| `talent` | TaW on one or more **named** talents | ~40 |
| `talent-frei` | TaW **freely allocated** inside a category; needs a stored player allocation | 6 |
| `talent-kat` | TaW blanket bonus to a whole talent category | 2 |
| `basiswert` | AT/PA/BL/FK/INI/MR/Wundschwelle/Todesschwelle/GS/Ausweichen/Resilienz | 14 |
| `ressource` | LE/AsP/AuP/Psyche, current and/or maximum | 10 |
| `traglast` | Maximum carrying capacity (`traglastBonus` already exists) | 2 |

These land exactly on the target union already designed for item bonuses
(`attr | baseValue | resource | talent`). The perk system can reuse that
plumbing wholesale; the only difference is the condition — "perk taken at stage
n" instead of `location === 'getragen'`.

### Display only — the player tracks it, the app just shows the text

Confirmed by the developer: none of these ever enter a calculation.

| Code | Meaning | Count |
|---|---|---|
| `situativ` | Check modifier bound to a situation ("im Kampf", "bei Initialschlag", "ab der 5. Kampfrunde") | ~18 |
| `regel` | Boolean rule statement, no number | ~20 |
| `aktiv` | Active ability with a usage limit (1x täglich, 2x wöchentlich); includes every Heldenkraft | 13 |
| ↳ | Heldenkraft is a **single pick**, not two: it grants one in-combat *and* one out-of-combat effect together (see conflict section 10). Not yet split out per-Heldenkraft in the catalog below. | |
| `prozent` | Percentage cost/time/damage modification | 12 |
| `waffe` | Weapon or damage modification | 9 |
| `stufenfk` | Named graded ability (Schatzsicht I/II/III); **the master list of what these do is missing** | 10 |
| `qs` | Qualitätsstufen bonus; not auto-rolled today | 7 |
| `regen` | Dice-based regeneration per day | 1 |

### Cross-cutting flag

`wahl` — an either/or effect requiring a stored player choice. Three cases:
`Zielwasser` and `Treffsicher` ("Attackebasis **oder** Fernkampfbasis"), and
`Magischer/Energetischer Fluss` ("AsP **oder** ADP"). Not its own type; a flag
on an otherwise normal computed effect.

---

## Catalog

Stage columns hold the value **at** that stage (absolute, per rule 9). `—` means
the effect has no stage scaling. Names are taken from the **tree graphic**; where
the description list disagrees, the graphic name is used here and the conflict is
recorded in the last section.

### Mut (Rondra / Praios)

| Tier | Perk | Stufe 1 | Stufe 2 | Stufe 3 | Kat. | Ziel |
|---|---|---|---|---|---|---|
| 20+ | Goldenes Herz | 5 | 10 | 15 | `basiswert` | Resilienz |
| 20+ | Motivationstalent | 2 | 4 | 8 | `situativ` | Koop-Aktionen erleichtert |
| 20+ | Bärenmut | geringe | mittlere | große | `situativ` | Mutproben für Gefahren entfallen |
| 20+ | Hallender Schrei | 2 | 4 | 6 | `situativ` | Kampfschreie halten Runden länger |
| 20+ | Mutburg | 10 | 20 | 30 | `ressource` | MaxPsyche |
| 20+ | Anführer | 1 | 2 | 3 | `situativ` | Gruppenpsychemali verringert |
| 20+ | Seelenheil | 1d6 | 1d6+2 | 1d6+10 | `regen` | Psyche pro Tag zusätzlich |
| 20+ | Innerer Schutz | 10 | 20 | 30 | `basiswert` | Magieresistenz |
| 20+ | Reines Wesen | 10% | 20% | 30% | `prozent` | Karmagewinn |
| 20+ | Risikobereit | 1–3 | 1–6 | 1–9 | `situativ` | selbstauferlegte Erschwerung auf Angriff/Gegnerreaktion |
| 28+ | Friedensstifter | 4 | 10 | 16 | `situativ` | Sozialinteraktionen während eines Kampfes |
| 28+ | Speerspitze | 1 | 2 | 3 | `situativ` | erste Angriffsprobe bei Initialschlag (alle) |
| 28+ | Heilig | −10% | −25% | −50% | `prozent` | Karmakosten |
| 28+ | Unbeugsame Ausstrahlung | 1 | 2 | 4 | `basiswert` | Initiative |
| 28+ | Erstschlag | ? | ? | ? | ? | **keine Beschreibung** |
| 32+ | Hoffnungsbringer | — | — | — | `aktiv` | AOE 20 Psyche, 2x wöchentlich |
| 32+ | Bis zum Tod | — | — | — | `regel` + `basiswert` | 0 LE Ohnmachtsgrenze; Todesschwelle +5 |
| 32+ | Wahrhaftig | — | — | — | `aktiv` | Rettung aus Wahn, 1x täglich |
| 34+ | Heldenseele | — | — | — | `aktiv` | Heldenkraft: alle Debuffs entfernen, 40 Psyche, 1x täglich |
| 60 | *(unbesetzt)* | | | | | |

Unassigned line in the source: „Kritische Mutprobe lässt Mutprobe für 1/2/alle
Helden entfallen" — sits between *Heilig* and *Unbeugsame Ausstrahlung* without a
label.

### Klugheit (Hesinde / Tsa)

| Tier | Perk | Stufe 1 | Stufe 2 | Stufe 3 | Kat. | Ziel |
|---|---|---|---|---|---|---|
| 20+ | Sternlesen | 10 | 20 | 40 | `talent` + `qs` | Sternkunde; Prophezeien QS +0/+0/+1 |
| 20+ | Wissenssucher | 20 | 40 | 60 | `situativ` | Analyse benötigt weniger TaW |
| 20+ | Erinnerungen | Tag | Woche | für immer | `regel` | Information wird abgespeichert |
| 20+ | Lehrmeister | 10 | 20 | 30 | `talent` | Lehren-TaW; reduziert Voraussetzung um denselben Betrag |
| 20+ | Leseratte | 5% | 10% | 20% | `prozent` | Lesekapazität |
| 20+ | Kopist | 10 | 20 | 30 | `talent` + `qs` | Schriftlicher Ausdruck; SPQS +0/+0/+1 |
| 20+ | Sprachenkünstler | 2 | 4 | 6 | `talent-frei` | frei auf bereits erworbene Sprach-/Schrifttalente |
| 20+ | Schöpfer | −15% | −30% | −50% | `prozent` + `qs` | Produktionszeit; QS +0/+1/+2 |
| 20+ | Magischer/Energetischer Fluss | 10 / 5 | 20 / 10 | 40 / 20 | `ressource` `wahl` | AsP+MaxAsP **oder** ADP+MaxADP |
| 20+ | Gebildet | 10 | 20 | 30 | `talent-frei` | frei verteilbare Wissenstalente |
| 28+ | Schachmeister | 10 | 30 | 50 | `talent` + `regel` | Kriegskunst-TaW; Schwachstellenbestimmung |
| 28+ | Allgemeinwissen | 5 | 10 | 20 | `talent-kat` | Grundwert aller Wissenstalente |
| 28+ | Visionär | 15 | 30 | 50 | `talent` + `regel` | Philosophieren-TaW; erleichtertes Neuschaffen |
| 28+ | Macht der Artefakte | 20 | 50 | 80 | `basiswert` | Artefaktkontrolle |
| 28+ | Astraler/Energetischer Rückfluss | 20 / 10 | 40 / 20 | 60 / 30 | `ressource` | MaxAsP und MaxADP |
| 32+ | Genie | — | — | — | `talent-frei` + `regel` | +60 frei (keine Kampf-, Sprach-/Schrift-, Körpertalente); erschwerungslose Zweitaktion |
| 32+ | Multitasking | — | — | — | `regel` | Instantcast bzw. starke Zeitreduktion für Interaktion |
| 32+ | Geist über Materie | — | — | — | `aktiv` | Heldenkraft: göttlicher Einfall, 2x täglich |
| 34+ | Offenbarung | ? | ? | ? | ? | **keine Beschreibung** |
| 60 | *(unbesetzt)* | | | | | |

### Intuition (Firun)

| Tier | Perk | Stufe 1 | Stufe 2 | Stufe 3 | Kat. | Ziel |
|---|---|---|---|---|---|---|
| 20+ | Magieimpuls | Richtung | Anwender | Magiesichtinfo | `regel` | Magiesichtimpuls liefert |
| 20+ | Naturbursche | 10 | 20 | 30 | `talent` | Orientierung, Wildnisleben |
| 20+ | Zielwasser | 1 | 2 | 3 | `basiswert` `wahl` | Attackebasis **oder** Fernkampfbasis |
| 20+ | Phexische Gabe | 15 | 30 | 50 | `talent` + `regel` | Schätzen-TaW; verstärkte Wertanalyse |
| 20+ | Reichweite | 50 | 100 | 150 | `waffe` | MaxReichweite |
| 20+ | Empfindliches Näschen | giftige Gase | Tiere identifizieren | Giftwahrnehmung | `regel` | Entdecken |
| 20+ | Adlerauge | 15 | 30 | 50 | `talent` + `regel` | Sinnesschärfe; erhöhte Sichtreichweite |
| 20+ | Decoder | 10 | 20 | 30 | `talent` | Kryptografie und Sprachenkunde |
| 20+ | Selbstanamnese | äußere | innere | psychische | `regel` | Identifizierung von Verletzungen |
| 20+ | Zwergennase | I | II | III | `stufenfk` | Zwergennase |
| 28+ | Schatzsicht | I | II | III | `stufenfk` | Schatzsicht |
| 28+ | Magiesicht | 1 | 2 | 3 | `stufenfk` | Magiesicht |
| 28+ | Fokussiert | draußen | weit draußen | kritisch | `situativ` | Handwerksproben-Korrekturwurf |
| 28+ | Bereit | 1x/Woche | 1x/Tag | 2x/Tag | `aktiv` | Überraschungsangriff als normaler Angriff deklarierbar |
| 28+ | Aurasicht | I | II | III | `stufenfk` | Aurasicht |
| 32+ | Nächtliches Treiben | — | — | — | `stufenfk` | Nachtsicht +1 |
| 32+ | Gegner lesen | — | — | — | `situativ` | ab 5. Kampfrunde alle defensiven Kampfproben um 4 erleichtert |
| 32+ | Gefahreninstinkt | — | — | — | `stufenfk` | Gefahrengespür +I |
| 34+ | *(Kasten leer)* → Vorhersehung | ? | ? | ? | `aktiv` | „Heldenkraft:" — **Effekttext fehlt** |
| 60 | *(unbesetzt)* | | | | | |

### Charisma (Travia / Rahja)

| Tier | Perk | Stufe 1 | Stufe 2 | Stufe 3 | Kat. | Ziel |
|---|---|---|---|---|---|---|
| 20+ | Spiritualität | kürzer | effizienter | kann nicht fehlschlagen | `situativ` | Meditieren- und Beten-Proben |
| 20+ | Tierfreund | 20 | 20 | 20 | `talent` + `regel` | Abrichten-TaW; erleichterter Bund, Bindungsstärkung |
| 20+ | Goldene Zunge | 15 | 30 | 50 | `talent` | Überreden |
| 20+ | Selbstbewusst | 10 | 25 | 40 | `talent` + `regel` | Selbstbeherrschung; erhöhte Attraktivität |
| 20+ | Muse der Künste | 20 | 20 | 20 | `talent` + `qs` | Malen, Musizieren, Singen; QS +0/+1/+2 |
| 20+ | Wahrheitssucher | 20 | 40 | 60 | `talent` | Menschenkenntnis |
| 20+ | Dramatiker | 10 | 20 | 40 | `talent` | Schauspielkunst |
| 20+ | Irrenarzt | 20 | 40 | (ab 3.) +20% | `talent` + `prozent` | Heilkunde Seele; Psycheregeneration bei Hilfe |
| 20+ | Romantiker | 10 | 30 | 50 | `talent` + `regel` | Betören; erhöht Attraktivität |
| 20+ | Kleider machen Leute | 10 | 30 | 50 | `talent` + `regel` | Verkleiden; Kleidungssozialstatus zählt als eigener |
| 28+ | Schmarotzer | wohlwollender | großzügiger | generös | `regel` | NSC-Haltung |
| 28+ | Tierzunge | Tierempathie | Tierempathie II | Tierzunge I | `stufenfk` | Tierempathie / Tierzunge |
| 28+ | Zweitgesicht | 20% | 50% | 90% | `prozent` | temporäre Verringerung/Erhöhung des Rufs |
| 28+ | Empath | I | II | III | `stufenfk` | Empath |
| 28+ | Ewige Freunde | schneller freundlich | tolerieren mehr | bleiben Freunde | `regel` | NSC-Beziehung |
| 32+ | Freund oder Feind | — | — | — | `regel` | direkte Identifizierung der Einstellung des Gegenübers |
| 32+ | Der Auftritt | — | — | — | `aktiv` | richtet alle Aufmerksamkeit auf den Anwender, 1x täglich |
| 32+ | Wort der Macht | — | — | — | `stufenfk` | Wort der Macht I |
| 34+ | Dominanz | — | — | — | `aktiv` | Heldentalent: NSC führt nichtselbstgefährdende Aktion aus, 1x täglich |
| 60 | *(unbesetzt)* | | | | | |

### Fingerfertigkeit (Phex)

| Tier | Perk | Stufe 1 | Stufe 2 | Stufe 3 | Kat. | Ziel |
|---|---|---|---|---|---|---|
| 20+ | Glücksdaumen | 10 | 20 | 40 | `talent` + `qs` | Brett- und Kartenspiel; BK-Glückswurf +0/+1/+3 |
| 20+ | Ressourceneffizienz | −20% | −50% | −75% | `prozent` | Input-/Ressourcenkosten |
| 20+ | Diebische Elster | 10 | 30 | 50 | `talent` | Taschendiebstahl |
| 20+ | Jonglierkünstler | 15 / 0 | 30 / 5 | ? / 10 | `talent` | Gaukelei; Wurfwaffen |
| 20+ | Hüttchenspieler | 10 | 30 | 50 | `talent` + `qs` | Falschspiel; Glücksproben +0/+0/+1 |
| 20+ | Fesselspielchen | 10 | 20 | 30 | `talent` | Fesseln und Fallenstellen |
| 20+ | Tavernenschläger | 5 | 10 | 20 | `talent` | Raufen und Ringen |
| 20+ | Handwerkskunst | 15 | 30 | 50 | `talent-frei` | frei verteilbare Handwerkstalente |
| 20+ | Treffsicher | 1 | 2 | 3 | `basiswert` `wahl` | Attackebasis **oder** Fernkampfbasis |
| 20+ | Freizeitschließer | 10 | 20 | 30 | `talent` + `situativ` | Schlösserknacken; Schwierigkeit −0/1/2 |
| 28+ | Kriegsheld | 10 | 20 | 30 | `talent-frei` | frei verteilbare Waffentalente |
| 28+ | Exoten | erschwerungslos | halbe TaW-Zuordnung | als Standardwaffe bewertet | `waffe` | exotische Waffen |
| 28+ | Qualitätsarbeit | 1 | 2 | 3 | `qs` | Handwerksqualität |
| 28+ | Schneller Finger | ? | ? | ? | ? | **keine Beschreibung** |
| 28+ | Paradeprofi | 1 | 2 | 3 | `basiswert` | Paradebasis |
| 32+ | Fest in der Hand | — | — | — | `regel` | kann nicht durch Patzer entwaffnet werden |
| 32+ | Schnell bewaffnet | — | — | — | `regel` | Waffenwechsel/-ziehen kostet keine Aktion (außer Wurfwaffen/Munition), 1x pro Aktion |
| 32+ | Schattengriff | — | — | — | `aktiv` | Interaktion verborgen durchführen, 1x täglich |
| 34+ | *(Kasten leer)* → Blitzschnell | — | — | — | `aktiv` | +1 Aktion pro Runde, danach Erschöpfung (5 Aktionen), 1x täglich |
| 60 | *(unbesetzt)* | | | | | |

Description without a box: **Fingerakrobat** — Wurfwaffenschaden +1/+2/+3
(`waffe`).

### Gewandtheit (Efferd)

| Tier | Perk | Stufe 1 | Stufe 2 | Stufe 3 | Kat. | Ziel |
|---|---|---|---|---|---|---|
| 20+ | Gut zu Fuß | 5 | 15 | 30 | `ressource` | ADP und MaxADP |
| 20+ | Wandrenner | 10 | 25 | 40 | `talent` + `regel` | Klettern; erhöhte Klettergeschwindigkeit |
| 20+ | Freizeitakrobat | 10 | 30 | 50 | `talent` | Akrobatik |
| 20+ | Tanzbein | 15 | 30 | 45 | `talent` + `regel` | Tanzen; wirkt aufmerksamkeitserregend |
| 20+ | Schlangengleich | 10 | 20 | 30 | `talent` + `regel` | Körperbeherrschung; erhöhte Beweglichkeit |
| 20+ | Dauersprinter | 10 / 0 | 20 / 5 | 30 / 10 | `talent` + `ressource` | Athletik-TaW; ADP und MaxADP |
| 20+ | Schattenversteck | 10 | 20 | 30 | `talent` + `situativ` | Verstecken; erschwert Wahrnehmungsproben für Feinde |
| 20+ | Reitsportler | 10 | 20 | 40 | `talent` + `regel` | Reiten; Reittiere freundlicher gesinnt |
| 20+ | Ringkämpfer | 10 | 20 | 40 | `talent` | Ringen |
| 20+ | Freistilschwimmer | 10 / 0 | 20 / 1 | 35 / 2 | `talent` + `regel` | Schwimmen; Geschwindigkeit im Wasser |
| 28+ | Federleicht | 25% | 50% | 75% | `prozent` | Fallschadenreduktion |
| 28+ | Schnellstoß | 1 | 2 | 3 | `situativ` | Attackereaktion für Gegner erschwert |
| 28+ | Sprinter | 1 | 2 | 3 | `basiswert` | Geschwindigkeit |
| 28+ | Parierschritt | 1 | 2 | 3 | `basiswert` | Paradebasis |
| 28+ | *(Kasten leer)* → Leichtfüßig | −25% | −50% | −100% | `prozent` | Geschwindigkeitsreduktion auf unwegsamem Gelände |
| 32+ | Kampftänzer | — | — | — | `situativ` | Folgeangriffserschwerungen um zwei verringert |
| 32+ | Ausweichkünstler | — | — | — | `regel` | kritisches Ausweichen erlaubt kostenlosen Passierschlag |
| 32+ | Geräuschlos | — | — | — | `regel` | Schleichen/Gehen geräuschlos, Rennen reduziert, Rüstungen reduziert |
| 34+ | Adrenalinboost | — | — | — | `aktiv` | Heldenkraft: freies Ausweichen für Anwender + eine Person in direktem Kontakt, 2x täglich |
| 60 | *(unbesetzt)* | | | | | |

### Konstitution (Peraine / Boron)

| Tier | Perk | Stufe 1 | Stufe 2 | Stufe 3 | Kat. | Ziel |
|---|---|---|---|---|---|---|
| 20+ | Athlet | 10 | 30 | 50 | `talent` | Athletik |
| 20+ | Ausdauerlauf | 10 / 15 | 20 / 30 | 30 / 50 | `ressource` | ADP und MaxADP |
| 20+ | Muskelgedächtnis | 10 | 25 | 50 | `talent` | Körperbeherrschung |
| 20+ | Saufkopf | 10 | 20 | 40 | `talent` + `regel` | Zechen; kritische Patzer ohne Vergiftung |
| 20+ | Abgehärtet | 5 / 5 | 15 / 20 | 25 / 35 | `ressource` | LE und MaxLE |
| 20+ | Survivalist | leicht | mittel | stark | `regel` | Temperaturresistenz |
| 20+ | Freischwimmer | 10 / 1 | 20 / 2 | 30 / 4 | `talent` + `regel` | Schwimmen; Schwimmgeschwindigkeit |
| 20+ | Schwerbepackt | +25 kg | +50 kg | +100 kg | `traglast` | maximale Tragekapazität |
| 20+ | Tiefschläfer | ½ Stunde | 1 Stunde | 2 Stunden | `regel` | weniger Schlaf für „ausgeruht" |
| 20+ | Magischer Wall | 8 | 16 | 24 | `basiswert` | Magieresistenz |
| 28+ | Schildwall | 1 | 2 | 3 | `basiswert` | Blockenbasis |
| 28+ | Tiefseetaucher | 2 | 4 | 6 | `regel` | Tauchdauer in Runden |
| 28+ | Panzer | 1 | 2 | 3 | `basiswert` | Wundschwelle |
| 28+ | Kreislaufwunder *(Dublette)* | ? | ? | ? | ? | **siehe Konflikte** |
| 28+ | Metallmagen | leichte Giftresistenz | mittlere Giftresistenz | Zwergenmagen | `regel` | Giftresistenz |
| 32+ | Rüstmeister | — | — | — | `situativ` | Rüstungsausweicherschwerungen −1 |
| 32+ | Koloss | — | — | — | `ressource` + `regel` | +20 LE und MaxLE; kann nicht depositioniert werden |
| 32+ | Kreislaufwunder | −20% | −20% | −20% | `prozent` | Ausdauerkosten |
| 34+ | *(Kasten leer)* → Wandelnde Festung | — | — | — | `aktiv` | Heldenkraft: halber Schaden aus allen Quellen, danach Erschöpfung (5 Aktionen), 1x täglich |
| 60 | *(unbesetzt)* | | | | | |

Description without a box: **Atemübungen** — verringerter Ausdauerschaden um
10%/20%/50% (`prozent`).

### Körperkraft (Ingerimm)

| Tier | Perk | Stufe 1 | Stufe 2 | Stufe 3 | Kat. | Ziel |
|---|---|---|---|---|---|---|
| 20+ | Kampfrausch | I | II | III | `situativ` | 2/4/6 Runden Erleichterung 2/2/4 auf Angriffsproben, Erschwerung 2/2/1 auf defensive Proben |
| 20+ | Grobmotoriker | +20% | +40% | +60% | `prozent` | wertigerer Output bei Handwerkstalenten |
| 20+ | Gestählter Körper | 5 / 10 | 10 / 20 | 20 / 30 | `ressource` | LE und MaxLE |
| 20+ | Körperbau | 1 / 15 | 2 / 30 | 4 / 45 | `basiswert` + `ressource` | Wundschwelle; MaxADP |
| 20+ | Packesel | +25 kg | +50 kg | +100 kg | `traglast` | maximale Tragekapazität |
| 20+ | Kraftausgleich | 6:1 | 4:1 | 2:1 | `waffe` | Umwandlung Ausdauer → Extraschaden |
| 20+ | Härter | 1 | 2 | 3 | `waffe` | allgemeine Rüstungsdurchdringung |
| 20+ | Nahkampf | 10 / 5 | 20 / 10 | 30 / 15 | `talent` | Raufen; Ringen |
| 20+ | Aufpumpen | 20 | 30 | 40 | `talent` | Körperbeherrschung |
| 20+ | Berge versetzen | 1 | 2 | 4 | `waffe` | Depositionierung für Gegner in Feldern |
| 28+ | Kraftpaket | 2 | 4 | 6 | `waffe` | Nahkampfschaden |
| 28+ | Kampfkoloss | 20 | 40 | 60 | `talent` | Athletik und Akrobatik |
| 28+ | Boxer | 0,5x | 1x | 2x | `waffe` | waffenloser Nahkampf als Ausdauerschaden |
| 28+ | Schwere Waffen | 1 | 2 | 4 | `waffe` | AT-Wert für schwere/Zweihandwaffen |
| 28+ | Artillerie | +0 | +4 | +8 | `waffe` | alle Waffen werden Wurfwaffen, Zusatzschaden |
| 32+ | Stumpfe Macht | — | — | — | `regel` | kritische Treffer verursachen Ohnmacht (Effizienzwurf → Dauer) |
| 32+ | Kampfveteran | — | — | — | `talent-frei` | +20 TaW auf vier Nahkampfwaffen deiner Wahl |
| 32+ | Berserker | — | — | — | `talent` + `regel` | +50 Einschüchtern; erhöhte Gruppeneffektivität |
| 34+ | Grenzen brechen | — | — | — | `aktiv` | Heldenkraft: 5 Aktionen doppelter Schaden, danach Erschöpfung, 1x täglich |
| 60 | *(unbesetzt)* | | | | | |

---

## Data conflicts

Everything below has to be resolved with the GM before a catalog can be seeded.
The perk **name is the natural key**, so a name that differs between the tree
graphic and the description list is a genuine blocker, not cosmetic.

### 1. Name disagrees between graphic and description list

| Tree | Tier | Tree graphic says | Description list says | Note |
|---|---|---|---|---|
| Mut | 28+ | Friedens**s**tifter | Friedenstifter | spelling only |
| Klugheit | 20+ | *(none)* | — | — |
| Gewandtheit | 28+ | Parier**schritt** | Parier**schnitt** | changes the meaning (step vs. cut) |
| Körperkraft | 20+ | Grobmotoriker | Grobmotorik | spelling only |
| Körperkraft | 20+ | Kraft**ausgleich** | Kraft**schub** | different word |
| Körperkraft | 20+ | **Aufpumpen** | **Volle Kontrolle** | entirely different name |
| Körperkraft | 28+ | **Kampfkoloss** | **Athlet** | entirely different name, **and** collides with the existing `Athlet` at Konstitution 20+ |

### 2. Box exists, no description

| Tree | Tier | Perk |
|---|---|---|
| Mut | 28+ | Erstschlag |
| Klugheit | 34+ | Offenbarung |
| Fingerfertigkeit | 28+ | Schneller Finger |

### 3. Description exists, no box

| Tree | Tier (vermutet) | Perk | Effect |
|---|---|---|---|
| Fingerfertigkeit | 20+ | Fingerakrobat | Wurfwaffenschaden +1/+2/+3 |
| Konstitution | 28+ | Atemübungen | verringerter Ausdauerschaden 10%/20%/50% |
| Gewandtheit | 28+ | Leichtfüßig | Geschwindigkeitsreduktion auf unwegsamem Gelände −25%/−50%/−100% |

### 4. Empty box in the graphic

Only **one** empty box is an actual defect. The blank 34+ boxes are deliberate,
see "Hidden content" below.

| Tree | Tier | Likely intended | Basis |
|---|---|---|---|
| Gewandtheit | 28+ | Leichtfüßig | only remaining 28+ description, and the only unexplained blank outside the 34+ tier |

### 5. Duplicate inside one tree

**Konstitution** lists `Kreislaufwunder` **twice**, at 28+ and at 32+. The
description list has exactly one `Kreislaufwunder` (Ausdauerkosten −20%) and one
orphaned `Atemübungen` that has no box. Working hypothesis: the 28+ slot was
meant to be *Atemübungen* and was mis-copied. Needs confirmation.

### 6. Unassigned effect text

**Mut** — the line „Kritische Mutprobe lässt Mutprobe für 1/2/alle Helden
entfallen" sits between *Heilig* and *Unbeugsame Ausstrahlung* with no label of
its own. It could be a second effect of *Heilig*, or the missing description of
*Erstschlag*.

### 7. Missing content, known and intended

- **The `stufenfk` master list is missing entirely.** Ten perks grant graded
  named abilities (Schatzsicht I/II/III, Aurasicht, Empath, Zwergennase,
  Magiesicht, Tierzunge, Nachtsicht, Gefahrengespür, Wort der Macht,
  Kampfrausch). What each grade actually does is defined nowhere in this
  document. Confirmed by the developer as a known gap.

### 8. Ambiguous stage values

| Tree | Perk | Problem |
|---|---|---|
| Fingerfertigkeit | Jonglierkünstler | „+15/+30 Taw in Gaukelei" gives only **two** values for three stages |
| Charisma | Irrenarzt | „+20/+40 Taw Heilkunde Seele, (ab 3.) +20% Psychereg" — two TaW values, third stage switches to a different effect type |
| Charisma | Tierfreund | „+20 Taw Abrichten" — single value, no stage scaling given |
| Charisma | Muse der Künste | „+20 Taw" — single value, but QS scales +0/+1/+2 |
| Konstitution | Kreislaufwunder | „−20%" — single value, no stage scaling |
| Körperkraft | Kampfveteran | „+20 TaW auf vier Waffen" — single value, no stage scaling |
| Körperkraft | Berserker | „+50 TaW Einschüchtern" — single value, no stage scaling |

Per rule 9 stage values are absolute, so a perk with a single value either has
one stage only, or the missing stages were never written. The two readings cost
different amounts of pool, so this cannot be guessed.

### 9. Not a conflict: deliberately hidden content

Confirmed by the developer, and it changes how the following must be read.

- **Blank 34+ boxes are intentional.** Intuition, Fingerfertigkeit and
  Konstitution show an unlabelled black box at 34+ because **no player has
  reached that tier yet**. The GM reveals a Heldenhaftes Talent only once
  somebody actually picks it. The orphaned descriptions found in the same
  document (*Vorhersehung*, *Blitzschnell*, *Wandelnde Festung*) are the GM-side
  content for exactly those hidden boxes, not stray data. They are listed in the
  catalog above with a `(Kasten leer)` marker for that reason.
- **All eight 60-tier slots are unwritten on purpose.** Halbgöttliche Talente
  demand extreme dedication to a single attribute, so they are written when they
  become relevant, not up front.

**This is a real data-model requirement, not a content gap.** A perk needs a
reveal state, and the app has to honour it the same way the wiki honours
` ```gm ` regions: per `CLAUDE.md`, *hiding text from a reader is not enough, you
must not send it*. A perk the GM has not revealed must be stripped **server-side**
from the catalog response, otherwise any player reads the whole 60-tier in the
network tab. A client that merely declines to render it would already have
shipped it.

Two things follow that need a decision before building:

1. **Is the reveal global or per character?** "Revealed once somebody picks it"
   reads global (the whole group then sees it), but it could equally be scoped to
   the picking player. These produce different tables.
2. **How does a player pick something they cannot see?** If the 34+ box is blank,
   the pick cannot be a normal catalog selection. Most likely the GM performs the
   assignment, which makes this an admin action rather than a player-facing
   picker. Worth confirming, because it decides whether the 34+/60 tiers need any
   player UI at all.

### 10. Author's own open notes

From the final slide, verbatim:

- „Mut: Sozialtalente im Baum? Friedensstifter? Mehr Fähigkeiten?"
- „Klugheitsbaum" (no further text)
- „Vorhersehung: Bauchgefühl (muss distanzieren für int)"
- „Heldenkraft in zwei Aspekten spalten Kampf/Anders"

**Resolved by the developer:** the last note does *not* mean a Heldenkraft
becomes two picks. A Heldenkraft is still unlocked with a **single** pick — the
"split" is that the one unlock grants **two** effects at once, one usable in
combat and one usable outside combat (e.g. *Heldenseele* could read as "in
combat: remove all debuffs" / "out of combat: restore 40 Psyche", both from the
same 1x-täglich unlock). The uniform 10/5/3/1/1 shape is unaffected — this is a
property of the `aktiv` effect type (an `aktiv` perk carries two effect entries
instead of one), not an extra tier slot or an extra pool cost. None of the
Heldenkraft texts above have been rewritten into that two-effect split yet;
that rewrite still needs the GM to specify which of the two effects applies
where for each of the eight Heldenkräfte listed in the catalog.
