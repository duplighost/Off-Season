
# OFF-SEASON
### A Design Bible
**Genre:** Folk horror / small-town life sim / narrative day-loop
**Platform:** Browser (desktop-first, playable on laptop trackpad)
**Working alt titles:** *The Closing*, *Secure for Sea*
**Author:** Alexander Duncan Guitar · **Doc version:** 1.0

> *The summer people leave. You're the one who stays. So is something else.*

---

## 0. HOW TO USE THIS DOCUMENT (FOR AI CODING AGENTS)

This document is the single source of truth. Read it fully before writing code.

**Build order is mandatory.** Follow the Milestone Ladder in §12. Do not build Day 9 content before the Day 1 vertical slice runs.

**Invariants — never violate these:**
1. **Engine/content separation.** All narrative content (dialogue, schedules, chores, wrongness events, radio playlists) lives in JSON files under `/content`. Engine code never contains a line of dialogue. If you can't add a new NPC line without touching TypeScript, the architecture is wrong.
2. **Determinism.** All randomness flows through a single seeded PRNG (`mulberry32` or equivalent). Same seed + same player inputs = same run. The Wrongness Director must be reproducible for debugging.
3. **The horror is subtraction, not addition.** No jump scares. No monsters rendered on screen. No chase sequences. Dread is produced by removing things: sounds, people, light, color. If a proposed feature adds a screaming thing, it is wrong for this game.
4. **Quiet is diegetic.** Silence in this game is not a missing feature. Escalating quiet is the core horror instrument. Never fill dead air with placeholder music.
5. **Small-town scale.** ~12 named NPCs, one hand-crafted map, 9 days. Do not procedurally generate the town. Do not add districts. Depth over breadth, always.
6. **The Slack is never shown.** No sprite, no model, no shadow-with-eyes. It manifests only through wrongness events and audio. This is non-negotiable.

**Division of labor suggestion (if multiple agents):** systems agent owns `/src` (director, time, save, renderer); content agent owns `/content` (dialogue JSON, schedules, event definitions) and must validate against the schemas in §9 before committing.

---

## 1. HIGH CONCEPT

You are the **Seasonal Transition Officer** for the town of **Lantern Neck, Connecticut** — Public Works, department of one. Every September, when the summer people drain out of town, you work the **Closing Checklist**: pull the swim lines, drain the pool, haul the docks, shut the boardwalk lights down section by section. Municipal maintenance. You've done it, or watched your uncle do it, your whole life.

The chores are a rite. They always were. The town is a ship, winter is a crossing, and the year-rounders are the crew — 200 souls, entered by name and household in a Ledger at Town Hall. When the last item on the checklist is done — **douse the Lantern** — the town goes dark and quiet for the winter, and something the old-timers call **the Slack** comes ashore to take the count. It doesn't hunt. It *reconciles*. Whatever it finds that isn't on the manifest gets put over the side.

This year, someone stayed who shouldn't have. A summer person, closing up her dead mother's cottage, who missed the last reasonable way out. You found her the way you find everything in this town — a light on in a window that should be dark.

You have nine days. The checklist doesn't stop. Neither does the count.

**Elevator pitch:** *Papers, Please* meets *The Wicker Man* on Long Island Sound, played through the verbs of a small-town maintenance job.

---

## 2. PILLARS

1. **Maintenance is ritual.** Every gameplay verb is a chore. The player performs the rite before understanding it. Horror through the mundane, never despite it.
2. **The town is a ship.** Winter is a voyage. The Ledger is the crew manifest. A stowaway endangers everyone — and the moral weight of the game is what you do about her.
3. **Quieter and wronger.** Systemic decay across nine days: audio layers subtracted, palette desaturated, NPC routines drifting, one recurring train getting stranger. The player should *feel* the volume knob of the world turning down.
4. **Complicity, not combat.** There is no weapon, no fail-state death loop. The threat model is social and bureaucratic-cosmic: being noticed, being counted, being short one name.
5. **The permanent fixture.** The emotional core: what it costs to be the one who stays when everyone else is temporary — and whether anyone can ever be added to the roster of the staying.

---

## 3. TONE & INFLUENCES

**Tone words:** hushed, municipal, brackish, off-brand cozy curdling into dread, kind people doing a terrible arithmetic politely.

**Influences (steal the listed thing, not the whole game):**
- *Pathologic 2* — day structure with real deadlines; the town as an organism (take 10% of its cruelty).
- *Night in the Woods* — small-town texture, routine-based intimacy with NPCs.
- *Return of the Obra Dinn* — confidence in restraint; a manifest of souls as a central object.
- *Papers, Please* — bureaucracy as moral machinery; the Ledger/meter-reading loop.
- *Anatomy* (Kitty Horrorshow) — domestic spaces going wrong through tiny deltas.
- *The Wicker Man / The Lottery (Shirley Jackson)* — communal complicity, ritual hiding inside civic normalcy.
- *Hypnospace Outlaw* — worldbuilding through mundane documents (flyers, receipts, municipal forms).
- *Kentucky Route Zero* — permission for quiet, literary dialogue.

**Anti-influences:** *Five Nights* anything, chase-horror, gore, cult robes, chanting. The town's religion is the checklist.

---

## 4. SETTING: LANTERN NECK, CT

A fictional shoreline town on Long Island Sound, unmistakably eastern-Connecticut coded: a boardwalk running beside active train tracks, a drawbridge over a tidal river, a state park beach that "closes" after Labor Day, cottage colonies that empty to nothing, one diner that never closes, and across the bay — always visible, always humming — the twin domes of a nuclear power station whose lights never go out.

Population: ~4,100 on Labor Day weekend. **200** by the equinox. The green highway sign at the town line reads *LANTERN NECK — settled 1671* and somebody has bolted a smaller municipal sign beneath it: **SEE YOU NEXT SUMMER.**

### 4.1 Districts (one hand-built map, ~8 zones)

| Zone | Description | Role |
|---|---|---|
| **Main Street** | Two blocks: Town Hall, the Anchor Light Diner, the Book Ark, hardware, shuttering gift shops | Social hub; save point; Ledger |
| **The Boardwalk** | Half-mile promenade between beach and train tracks; light poles in 9 numbered sections | The nightly light-shutdown rite; the train |
| **The Point** | Rocky headland with the lighthouse — locals just say **the Lantern** | Final chore site; best view of the Station |
| **The Harbor** | Docks, dinghy racks, harbormaster's shack, the ferry slip | Days 3–4 chores; last ferry |
| **Black Rock Colony** | Summer cottages, dirt lanes, hydrangeas going brown | June's cottage; the emptying |
| **The Neck** | Year-rounder houses, including yours | Home base; neighbors who notice things |
| **Rock Neck State Park** | Beach, bathhouse, pool, a gate you will chain | Days 1–3 chores; later, the wrong place to be |
| **The Marsh** | Tidal flats, reeds, an old duck blind | Hiding places; the Low-Tide Club's shoreline |

**Offstage but visible:** the **Station** across the bay (nuclear plant — steam plume, red aviation lights; exempt from the Closing; the old-timers find this obscene: *"They never close. It's rude."*), and **Shorehaven** assisted living, up the hill, where your Uncle Sal lives.

### 4.2 The Shoreliner (recurring constant)

An Amtrak-analog passes along the boardwalk six times daily, stopping at the depot twice. It is the game's dread metronome:
- **Days 1–3:** normal. Horn, crossing bells, stops on schedule.
- **Days 4–6:** passes without stopping. Platform departure board goes blank.
- **Days 7–8:** you *hear* it — horn, rail hum — but if you're watching the tracks, nothing passes.
- **Day 9:** you see it pass once, in total silence.

This is a scripted system, not the director's job. One element, one escalation ladder, never explained.

---

## 5. THE MYTHOS (SPOILER TIER — INTERNAL TRUTH)

The player never reads this section. NPCs never info-dump it. It leaks out in fragments (see §5.2).

**The bargain.** Winter of 1694, the town should have died — iced harbor, failed catch, a wreck offshore. It didn't. The founders' story told at the clambake says the town "learned to winter." The truth in the old records: the town agreed to run itself like a vessel. Every year it takes on passengers (summer) and pays for the season by **closing correctly**: an accurate accounting of the living, delivered on time, followed by dark and quiet until spring. The sea's agent of reconciliation — the thing that audits — the old-timers call **the Slack**, after slack tide: the pause between tides when the water goes still and anything can move through it.

**The rules, as the town understands them:**
1. While the **Lantern** burns, the town is *open* — a host. Hosts are protected; so are their guests. This is why nothing has ever happened to a tourist.
2. The **Closing Checklist** is the decommissioning rite. Each item genuinely matters. Done wrong or late, it accrues **disruption** (see §7.3).
3. The **Ledger** at Town Hall is the winter manifest: 200 souls by name and household. The count is delivered on Day 6 via the meter reading — the census disguised as utilities.
4. When the Lantern is **doused** (Day 9), the town is *closed* — under way. The Slack comes ashore over the winter and reconciles the manifest. It knows **numbers and names, not faces.** Anyone present but not entered is a stowaway. Stowaways go over the side. No one has ever described what that means, which is worse.
5. The Ledger has bureaucracy, and bureaucracy has loopholes. Form 12-C: *Amendment to Household Composition.* A stowaway doesn't need to be hidden. She needs to be **claimed.**

**What the Slack is:** never answered. Not a god, not a monster with a face. Treat it as a *procedure the water runs.* The Station across the bay — lit all winter, never closing — is the one modern thing outside the arrangement, and whether the Slack minds is a question the game raises exactly once and never resolves.

### 5.1 The town's complicity spectrum

Not a cult. A municipality. Maybe 30 people know the whole shape of it (Margie, Cutter, the Low-Tide Club, your Uncle Sal, Fr. Amaral in his own grieving way). Another 100 know *not to ask.* The rest are children and the willfully cozy. Nobody chants. They bring you casseroles during Closing week because you're "working so hard." That's the horror.

### 5.2 The learn-it ladder (what the player can discover, when)

| Day | Available fragment | Source |
|---|---|---|
| 1 | Checklist item 9 is worn illegible; Margie: "It'll be legible when it's time. It's laminated, not magic." | Town Hall |
| 2 | Uncle Sal: "Don't douse it early. Whatever they tell you. *Early is worse than never.*" | Shorehaven |
| 3 | Founders' plaque: "…and in that winter the Town learned to keep its own count." | The Point |
| 4 | Old harbormaster's log (Cutter's shack): departures ledger from 1811 with two entries struck through and the note *"put over"* | Harbor |
| 5 | Fr. Amaral, obliquely: why he rings the bell during the Watch — "So no one faces the water alone." | Church |
| 6 | The Ledger itself: 200 lines, one blank line at the bottom of every year's page. Always exactly one. | Town Hall |
| 7 | Sal, lucid for ninety seconds: the whole shape of it, in ship's terms. The scene the game is built around. | Shorehaven |
| 8 | Form 12-C discovered (if trust path open) | Margie / Town Hall records |

---

## 6. CHARACTERS

**WREN** (player; renameable) — 30s, year-rounder, took over Public Works from Uncle Sal three years ago. Job title on the laminated badge: *Seasonal Transition Officer.* Owns a truck, a keyring the size of a fist, and a house on the Neck. The keyring is the progression system (§7.1). Wren has done the Closing twice before and never once wondered why item 9 was illegible. That's the kind of employee this town hires.

**JUNE CARROW** — 26. Her mother owned the gray cottage on Delancey Lane in Black Rock. Mother died in June; June came to close the estate in August and couldn't make herself finish sorting a dead woman's summer things. Missed the sensible exits. Her car "is waiting on a part" (every mechanic in a fifty-mile radius is suddenly waiting on a part). Sharp, grief-slowed, allergic to being handled. She thinks the town is quaint-creepy until Day 5, when she stops thinking that. Relationship meter with Wren gates two endings.

**MARGIE PELL** — Town clerk, 60s. Hands you the checklist Day 1 with a cider donut. Warm as a woodstove and precisely as capable of burning you. Custodian of the Ledger. Never lies; masterfully declines to say. By Day 6 the player should be terrified of her kindness.

**UNCLE SAL** — Your predecessor, at Shorehaven. In and out of the fog. Keeps asking whether you've doused it yet, then telling you not to douse it early. The Day 7 lucid scene is the emotional keystone of the whole game.

**ROZ** — Owns the Anchor Light Diner, the only thing open all winter. Coffee is the save mechanic. Notices *everything*: "Big appetite this week, hon" when you buy food for two (this is a real Suspicion trigger, §7.5). Her son **PETEY**, 17, telescope kid, watching the Station across the bay: "The steam plume stopped drifting. Steam *drifts*, Wren." Petey is leaving after this winter, for good, and everyone pretends that's fine.

**EDITH** — Runs the **Book Ark**, a used bookstore metastasized across a barn and three outbuildings, staffed by nine cats. The cats are the wrongness early-warning system (§7.3): they stare at the spot *before* the event triggers. The tuxedo cat, **Gigi**, adopts Wren around Day 3 and is the only character allowed to be uncomplicatedly good.

**CUTTER MARSH** — Harbormaster. Runs the last ferry Day 7. Speaks in tide tables. Knows everything; says nothing; leaves his shack unlocked on Day 4 anyway, which is its own kind of speech.

**FR. AMARAL** — Pastor of Our Lady, Star of the Sea. Portuguese fishing-family stock. Does not bless the Closing and does not fight it; he rings the Angelus at odd hours during the final days and keeps the church unlocked. The confessional is a free space: the one place Wren can say true things with no Suspicion consequence — except once, late, when it matters. Written with dignity: a good man keeping a small light in a compromised town, not a punchline and not a fraud.

**THE LOW-TIDE CLUB** — Gus, Alma, and Second Gus. Three retirees who stand at the waterline every dusk, coffee in hand, facing the Sound. Functionally one entity. They wave. On Day 8 they don't wave, because they're listening.

**HUTCH** — The plow guy. "Starts in November." Appears exactly once, Day 9, early, checking his plow blades. Says: "See you on the other side of it." Drives off. The game's driest joke.

---

## 7. CORE LOOP & SYSTEMS

### 7.0 The day loop

Each of the 9 days runs the same skeleton (~20–30 min of play):

1. **Morning** — wake at the Neck; radio on (see §7.7); truck to Town Hall or straight to the day's chore. Checklist UI shows today's item(s).
2. **Chores** — the day's rite (§7.2). Doing them correctly, incorrectly, or sabotaging them is the central expressive choice.
3. **Free roam** — talk, snoop, shop, visit June, visit Sal, follow cats. NPC schedules (§7.4) make the town legible; deviations make it dreadful.
4. **Dusk** — boardwalk light section shutdown (Days 5–9); the Low-Tide Club at the waterline; the train.
5. **Night** — one directed beat (scripted or director-placed). Curfew is soft: nothing *stops* you being out, but Suspicion accrues and the town gets… attentive.
6. **Sleep** — day rolls over. Coffee at the Anchor Light any time = save.

**No fail-death.** Time pressure is real (chores expire; June needs supplies; the count lands Day 6) but the game never kills Wren. Consequences are narrative, cumulative, and mostly about who trusts you and how wrong the winter goes.

### 7.1 The Keyring (progression)

Wren's job comes with keys, and keys are the metroidvania. Start with: truck, bathhouse, pool shed, boardwalk panels. Earn/find: Rock Neck gate, harbor shack, church basement, Town Hall records room, the Lantern itself (Day 8, from Margie, in a small ceremony that should feel like being handed a knife). ~10 keys total. Every key is diegetic — issued, borrowed, copied, or quietly not returned.

### 7.2 The Closing Checklist (chore/rite system)

One laminated card, nine items, doubles as the quest UI. Item 9 is illegible until Day 8.

| Day | Item | Gameplay | Ritual correctness detail |
|---|---|---|---|
| 1 | Pull the swim lines; beach flags down | Rowboat mini-loop, buoy winching, flag fold | Flags folded *seaward* face in — Sal's way. Doing it the "efficient" way = disruption +1, and nobody tells you |
| 2 | Board the bathhouse; drain the town pool | Valve sequence puzzle; carrying shutters | The pool must drain to *empty* before sundown. A delay (June, that first light in the window, happens today) tempts you to leave it half-drained |
| 3 | Chain the Rock Neck gate; last charter out | Drive + padlock; see Cutter | The gate chained *before* the charter clears the breakwater, not after |
| 4 | Haul the docks; rack the dinghies | Physicalish winch/timing task | Every dinghy accounted. One is missing. (June's mother's. Thread starts here) |
| 5 | Boardwalk lights: begin section shutdown | Panel-by-panel each dusk, sections 1→9 | One section per night, in order, at dusk exactly. This becomes the nightly ritual spine of Act II–III |
| 6 | **Read the meters** | The Count. Visit every occupied structure, log the meter | This is the census. June's cottage has a spinning meter. The forgery decision point (§8) |
| 7 | Deliver the Ledger; last ferry | Escort the book to Margie; the ferry leaves | The blank 201st line. Cutter holds the ferry ten extra minutes looking at you |
| 8 | Shutter Main Street; the Watch | Board windows with volunteers; church vigil at dusk | Item 9 becomes legible tonight: **"Douse the Lantern."** Sal's warning lands differently now |
| 9 | **Douse the Lantern** | Climb the Point. One switch. | Or don't. (§8, endings) |

Each chore is defined in `/content/chores/*.json` (§9.3) with explicit `steps[]`, a `correctness[]` array of checkable sub-conditions, and `disruptionOnMiss` values. **Design rule:** the correct way is always slightly slower, slightly more annoying, and never explained. Ritual correctness should feel like a fussy predecessor's habits until, around Day 6, the player realizes the fussiness is load-bearing.

### 7.3 The Wrongness Director

An *unease budget* system (AI-director pattern, pointed at dread instead of zombies).

- **Budget:** `W(day) = base[day] + disruptionDebt * DEBT_MULT`
  - `base = [0, 0, 1, 2, 3, 4, 6, 8, 10]` (indexed Day 1–9)
  - `disruptionDebt` accrues from: chores missed/late/incorrect (+1 to +3), June-related anomalies witnessed by NPCs (+1), the Day 6 count being wrong (+4), light section skipped (+2).
- **Events** are JSON-defined (§9.4) with `cost`, `tags` (visual / audio / npc / spatial / animal), `placementRules`, `prereqs`, `cooldownDays`, `oneShot`.
- **Placement rules:** max `2 + floor(day/3)` events per day; never two in the same district on the same day before Day 7; never inside the diner (the diner is sanctuary until a single scripted Day 8 violation — a directed beat, not the director's).
- **Witnessing:** if the player's viewport lingers ≥1.5s on an active event, mark `witnessed`. Witnessed events escalate along a defined `family` chain next spawn (wet footprints → wet footprints *ascending stairs* → a wet chair at your kitchen table).
- **Cats first:** any event placed within the Book Ark's radius, or while a cat is in the player's current zone, triggers the cat-stare tell 10–40s *before* activation. Gigi, once adopted, extends this to anywhere Gigi follows Wren.
- **Determinism:** director consumes the seeded PRNG stream `director:{day}`. Same seed, same choices → same haunting.

**Starter event pool (25 shipped at launch, examples):**
`extra_porch_chair` (a chair added to a porch you pass daily) · `boarded_window_unassigned` (a window boarded that isn't on your log) · `meter_spinning_backward` · `wet_footprints_wrong_way` (leading *into* the water) · `drawbridge_up_no_boat` · `low_tide_stare_offschedule` (the Club at the waterline at 3 PM, or 3 AM) · `dial_tone_gone` (payphone plays surf sounds) · `own_truck_radio_seek` (radio seeks to static between stations and holds) · `hydrangeas_bloomed_back` (out of season, one bush, blue as July) · `gull_single_inland` (one gull, motionless, facing away from the sea) · `doorbell_answered_by_no_one_home` · `your_own_flag_fold` (a flag you folded, refolded the wrong way).

### 7.4 NPC schedules & drift

Every NPC has a JSON weekly schedule (§9.2): zone, position anchor, activity, dialogue pool per slot. **Drift** is the decay layer: from Day 4, the director may spend budget to inject `scheduleDeviation` events — Roz wiping the same square foot of counter for an hour; Margie standing in the records room with the light off; the Club facing the water at the wrong hour. Deviations are events (witnessable, escalating), not random noise.

**Dialogue drift:** repeated barks lose words day over day (`"Morning, Wren!"` → `"Morning, Wren"` → `"Morning"` → a nod → nothing, eye contact held one beat too long). Implemented as per-line `decaySchedule` in dialogue JSON. Cheap to build, devastating in effect.

### 7.5 Suspicion & Trust

- **Town Suspicion (0–100):** rises from anomalies traceable to you — food for two (itemized diner receipts; Roz notices at 3+ double orders), lights seen in Black Rock after your rounds, chores sabotaged with witnesses, being out past midnight in the wrong zones. Falls slowly with clean days and completed chores. Thresholds change dialogue temperature (60+) and unlock the town *helping you look* for the anomaly (80+ — the worst thing that can happen while you're hiding someone is neighborly assistance).
- **June Trust (0–100):** built through visits, supplies, honesty beats, and one big scene per act. Gates: Trust ≥50 for her to *stay hidden when you say hide*; ≥70 for the Form 12-C path; ≥40 minimum or she attempts self-rescue on Day 7 (walks to the ferry in daylight — a scripted near-catastrophe with branching cleanup).
- **Signatory Trust:** the 12-C ending requires one of four possible household signatories (Roz, Edith, Fr. Amaral via the parish rolls, or Wren's own household — hardest, loudest). Each has a small trust track and a distinct ask scene.

### 7.6 Time, light, palette decay

- Day length shortens on a real curve: Day 1 sunset ~19:15 → Day 9 ~18:35, but *perceived* dusk arrives earlier each day (fog rolls in on a schedule).
- **Palette decay:** the renderer applies a per-day LUT: saturation −4%/day compounding, temperature shifting cold, blacks lifting slightly (fog floor). Day 1 is postcard September; Day 9 is a photograph of a photograph. One 16-color base palette; nine derived LUTs baked at build time.
- **Long shadows** unlock Day 5+ (fake low-sun pass) purely for mood.

### 7.7 Sound: the Subtraction System

The signature system. Ambient audio is 10–14 looped stems mixed live: surf, gulls, wind-in-grass, traffic, distant kids, HVAC hum, halyards clinking, insects, the Station's sub-bass hum (present *always*, felt more as everything else leaves).

- Per-day mix automation removes/reduces layers on a schedule (traffic dies Day 2, kids Day 1, gulls thin from Day 4, gone Day 7, wind holds until Day 8, insects cut mid-loop on Day 6 — mid-loop, audibly, once, while the player is outdoors).
- Disruption accelerates subtraction locally: high-debt zones go quiet *ahead* of schedule.
- By Day 9 the outdoor mix is: surf (reduced), the Station hum, and Wren's footsteps — then the footsteps' reverb tail shortens, as if the world got smaller. (One DSP trick, enormous payoff.)
- **The bell:** Fr. Amaral's Angelus is the one *added* sound in the back half. Added sound reads as grace precisely because the mix taught the player that subtraction is the law.

### 7.8 The radio (diegetic score)

Local AM station **WLNK 1290, "The Voice of the Shoreline."** Playlist thins daily: 8 songs → 5 → 3 → 1 → the one song, slower → static that keeps the song's rhythm → Day 9, the song audible *outside*, source unfindable, once.
Slots for **3–5 original Doopliss tracks** plus a fictional oldie. The DJ's patter (pre-recorded VO or text-ticker) decays like the dialogue does. This is the album-as-architecture delivery vehicle: write the songs, wire them in, let the game deprecate them in real time.

### 7.9 The population sign (UI as horror instrument)

A persistent HUD element styled as the town-line sign: **LANTERN NECK · POP. ####.** Ticks down as the town empties: 4,100 → 200 across Days 1–6. It is diegetic (the sign physically exists at the town line; Public Works updates it — *you* update it, Day 6, with a numeral kit and a ladder). The instrument turns on the player late: post-Closing, in certain endings, the number keeps moving when no one is updating it.

---

## 8. NARRATIVE STRUCTURE

### 8.1 Act breakdown

**ACT I — Routine (Days 1–3).** Establish the loop as genuinely pleasant: good chores, warm town, September gold. Day 2 dusk: the light in the Carrow cottage. Day 3: meeting June — wary, funny, grieving. The player's first real choice is small and enormous: log the anomaly (a light where none should be) or leave the line blank. Everything downstream remembers which.

**ACT II — Double Life (Days 4–6).** Supplies, cover stories, the missing dinghy thread, Suspicion management. The town empties past the point of camouflage — hiding a person gets harder as the crowd she could hide in evaporates. Day 6 is the crisis the whole structure funnels into: **the Count.** Her meter is live. You are the census. Options: report it (Ending 1 path), zero the reading and forge the log (opens Endings 2–4, +4 disruption debt if done sloppily, less if you've learned Sal's tricks), or stall (worst of both).

**ACT III — The Closing (Days 7–9).** Ferry gone, Main Street shuttered, the Watch, item 9 legible, Sal's lucid scene, the choice architecture resolving. The boardwalk light shutdown — one section a night since Day 5 — means Act III literally plays out in the dwindling pool of sections 8, 9, and the Lantern.

### 8.2 Ending matrix

| # | Name | Requirements | Shape |
|---|---|---|---|
| 1 | **By the Book** | Report June on or before Day 6 | She's "helped onto the last ferry" — the town is so *kind* about it, and you never learn whether that ferry arrives anywhere. Spring epilogue: new owners in the cottage; Margie gives you a commendation and a casserole dish to return. The safest ending, and it should feel like swallowing a stone. |
| 2 | **Stowaway** | Hide her through Day 9; Ledger unamended; douse the Lantern anyway | Night 9: reconciliation. The Slack takes the count door to door — rendered entirely in sound and light through Wren's windows. Sub-outcomes by hiding place; the church buys minutes (the bell), the marsh buys none. The horror-forward ending. |
| 3 | **The Long Light** | Refuse item 9; keep the Lantern burning past midnight Day 9 | The town stays *open* all winter: no Slack ashore, and the bargain broken. Epilogue montage: an iced-in, hosted town; thin faces; neighbors who know exactly what you did and say nothing over their fences; Wren keeping the light in shifts, alone, with a radio. Defiance, priced honestly. The permanent fixture as tragedy — or as the only lighthouse-keeper who ever meant it. |
| 4 | **Two Hundred and One** | June Trust ≥70; a signatory secured; Form 12-C filed by Day 8; clean count | The true ending. She isn't hidden; she's *claimed* — a household amended, a name entered in fresh ink on the year's blank 201st line (the line that was always there, every year, waiting; Margie never mentions it and absolutely knew). Day 9: douse the Lantern, walk home in the dark, and the dark walks past your door. Spring: June's still there, already complaining about the summer people, which is how you know it took. Warm and wrong in exactly the right ratio. |
| 5 | **The Last Train** *(secret)* | Suspicion ≥90, all Day 8–9 chores abandoned, stand on the depot platform Night 9 | The train that stopped stopping stops once, for you. The town lets you go — a town like this always finds another Wren. Epilogue: a classifieds page; a listing for a Seasonal Transition Officer; benefits include housing. Bleak, and the game's blackest joke. |

**Design note:** Ending 4 must be *hard* but discoverable — the loophole (households, not heads) is planted Day 6 in the Ledger's structure and confirmed Day 8 via Margie's records room. Ending 1 must be *easy* and quietly awful. The game's thesis lives in the distance between those two.

### 8.3 Fixed beats (scripted, director-exempt)

- D2 dusk: the light in the cottage.
- D4: the missing dinghy (June's mother's — June's abortive plan A).
- D5 night: first light-section shutdown; the boardwalk goes one-ninth dark with a *thunk* the whole town hears.
- D6: the Count; the sign updated to 200 (or 201, if you know why).
- D7: Sal, lucid: the ship's-terms speech. Ninety seconds, no music, no interrupt.
- D7: the last ferry — Cutter's ten minutes.
- D8: the Watch at Our Lady, Star of the Sea; item 9 resolves legible; the one diner violation (a wet ring on the counter at the seat no one used).
- D9: Hutch. Then the Point.

---

## 9. CONTENT SCHEMAS (CONTRACTS)

All content validates against these before build. Ship a `npm run validate:content` script (JSON Schema + custom lint: every dialogue `goto` resolves; every chore location exists; every event's tags are known).

### 9.1 Dialogue node
```json
{
  "id": "roz.d4.doubleorder",
  "speaker": "roz",
  "conditions": { "day": 4, "flags": ["bought_food_for_two>=3"] },
  "lines": [
    "Big appetite this week, hon.",
    "Growing boy."
  ],
  "choices": [
    { "text": "Stocking up before things close.", "effects": { "suspicion": 2 }, "goto": "roz.d4.stockup" },
    { "text": "(Say nothing. Pay.)", "effects": { "suspicion": 5, "flags": ["roz_clocked_you"] }, "goto": null }
  ],
  "decaySchedule": null,
  "oneShot": true
}
```

### 9.2 NPC schedule entry
```json
{
  "npc": "lowtide_club",
  "day": [1,2,3,4,5,6,7],
  "slots": [
    { "start": "17:40", "end": "18:20", "zone": "marsh_shoreline", "anchor": "waterline_a",
      "activity": "stand_facing_water", "barkPool": "club.dusk", "waveAtPlayer": true }
  ],
  "driftEligible": true
}
```

### 9.3 Chore definition
```json
{
  "id": "chore.d1.swimlines",
  "day": 1,
  "title": "Pull the swim lines; beach flags down",
  "zone": "rockneck_beach",
  "steps": [
    { "id": "rowout", "type": "boat_task", "target": "buoy_line_a" },
    { "id": "winch", "type": "hold_timing", "difficulty": 1 },
    { "id": "flags", "type": "interact_sequence", "targets": ["flag_1","flag_2","flag_3"] }
  ],
  "correctness": [
    { "id": "fold_seaward", "check": "flags_folded_seaward", "hint": "none", "disruptionOnMiss": 1 }
  ],
  "deadline": "sundown",
  "disruptionOnSkip": 3
}
```

### 9.4 Wrongness event
```json
{
  "id": "evt.wet_footprints_wrong_way",
  "cost": 2,
  "tags": ["visual", "spatial"],
  "family": "wet_footprints",
  "escalatesTo": "evt.wet_footprints_stairs",
  "placement": { "zones": ["harbor","boardwalk","neck"], "minDay": 3, "surface": "walkway" },
  "prereqs": [],
  "cooldownDays": 2,
  "oneShot": false,
  "catTell": true
}
```

### 9.5 Save schema (single JSON blob, localStorage + export-to-file)
```json
{
  "version": 1, "seed": 88291, "day": 5, "clock": "16:10",
  "flags": {}, "suspicion": 34, "juneTrust": 52, "disruptionDebt": 3,
  "choresDone": {}, "ledger": { "count": 200, "forged": false },
  "director": { "spent": {}, "witnessed": [], "escalations": {} },
  "audio": { "subtracted": ["kids","traffic"] }
}
```

---

## 10. ART DIRECTION

- **Style:** chunky pixel art, top-down 3/4 (Zelda-lite camera). Internal resolution **480×270**, integer-scaled. Readability first; texture through dither, not detail.
- **Base palette (16, September-coastal):**
  `#1b1f24 #3a3f47 #6b7280 #b9c0c9` (slate/fog grays) · `#0e3a4a #2d6e7e #7fb6c2` (Sound water, cold→warm) · `#c9a24b #e0c98f` (beach grass, sand) · `#8a4b2d #c96f3b` (brick, rust, leaves) · `#4a5d3a #7a8f5a` (hedge, marsh) · `#efe6d5` (clapboard white) · `#d94f30` (flag red / the Lantern's beam) · `#f2d16b` (window light — the game's most emotionally loaded color; June's window, the diner at night, the Lantern)
- **Per-day LUTs** as specified in §7.6, baked at build.
- **Fog:** 1-bit ordered dither sheets drifting on parallax; density keyed to day + zone debt.
- **Typography:** municipal DIN-flavored pixel font for UI/checklist; a worn serif for the Ledger and documents. The checklist UI is a literal laminated card, coffee ring included.
- **Animation economy:** 4-frame walk cycles; environmental life (flags, halyards, cats' tails, steam plume) carries the motion budget.

## 11. AUDIO DIRECTION

- Web Audio API graph: stem bus per ambient layer → per-day mix automation → zone send effects (one reverb, tail length day-keyed per §7.7).
- Stems sourced/recorded at 44.1k, loop-pointed, ~10–14 total.
- Foley priority list: footsteps (per-surface), winch, chain, breaker *thunk* (the light shutdown sound is a character — make it enormous), padlock, coffee pour (the save sound; make it the coziest thing in the game), the bell.
- Music: radio-only until Day 9 (§7.8). One non-diegetic cue exists in the entire game and it plays over the Ending 4 spring epilogue. Guard it jealously.
- **Original songs needed:** 3–5 Doopliss tracks for WLNK rotation + one "fictional oldie." The song that survives to Day 9 should be chosen for how it degrades — something euphoric that turns eerie at 0.85× with the top end rolled off.

---

## 12. TECHNICAL ARCHITECTURE & MILESTONE LADDER

**Stack:** TypeScript + Vite, Canvas 2D, zero engine dependency (optional: PixiJS if perf demands, but 480×270 won't). Entity-component-lite: plain objects + system functions, no framework ceremony. Tilemap via Tiled JSON (one map, layered). Pathfinding: grid A* on a baked nav layer. State machine per NPC. `mulberry32` PRNG, stream-split by consumer (`director:{day}`, `ambient`, `misc`). Deploy: Netlify, static.

```
/src
  /engine    (loop, renderer, input, audio graph, save, prng)
  /systems   (time, schedules, director, suspicion, chores, radio, palette)
  /ui        (checklist card, ledger, dialogue, HUD sign)
/content
  /dialogue  /schedules  /chores  /events  /radio  /map
/tools       (validate-content, day-warp harness)
```

**Debug tooling (build in M0, not later):** day-warp, clock-scrub, wrongness-budget overlay, schedule inspector, seed field in a dev pane, `?debug=1` URL flag. Deterministic replays make the director testable: write unit tests asserting identical event placement for fixed seed/choices.

**Milestone ladder:**
- **M0 — Graybox (walkable truth):** town map blocked in, player movement, truck fast-travel, clock, save/load, debug pane.
- **M1 — Vertical Slice (the contrast demo):** Day 1 complete (2 chores, 4 NPCs on schedule, diner save, checklist UI, radio with 3 songs) **plus a "Day 7 mode" toggle** that force-applies late-game palette LUT, audio subtraction, 3 wrongness events, and dialogue decay. The slice's job is to prove the *delta* — the whole game lives in the distance between those two toggles.
- **M2 — Act I:** Days 1–3 playable end-to-end; June discovery + first hiding loop; Suspicion online.
- **M3 — Spine complete:** Days 1–9; the Count; Endings 1–3; director at full budget curve.
- **M4 — Full matrix:** Endings 4–5, Form 12-C path, signatory scenes, Sal's Day 7 scene polished, radio decay finished.
- **M5 — Polish:** accessibility (screen-shake off, text size, colorblind-safe wrongness tells — never color-only), performance, save export, credits.

**Estimated content volume:** ~450 dialogue nodes, ~40 wrongness events (25 at M3), 9 chores, 12 NPC schedule files, 1 map (~120×90 tiles), 5–6 songs, ~14 ambient stems.

---

## 13. SAMPLE CONTENT — DAY 2 SCRIPT (ABRIDGED)

**Morning.** WLNK plays; the DJ reads a lost-cat notice (it's one of Edith's; the cat is fine; the notice runs all nine days). Checklist: *Board the bathhouse; drain the town pool.*

**Chore.** The pool's drain valve sequence is out of order from last year — Sal's handwriting on tape: `3-1-4, NOT 1-2-3. TRUST ME.` Doing it Sal's way takes longer. The water has to be *gone* by sundown. The game does not say why. (Correctness check: `drained_by_sundown`.)

**Free roam.** Roz: end-of-season pie, on the house. Petey on the seawall with the telescope: the plume line. Edith needs a hand moving the poetry annex indoors before the damp; Gigi supervises from a stack of Frosts.

**Dusk (fixed beat).** Driving the truck back along Black Rock: a light in the gray cottage on Delancey. Your log is open on the bench seat. A single input prompt, no timer, no music:

> ☐ *Log it.*  ☐ *Leave the line blank.*

**Night.** Whichever you chose, you dream about the pool. In the dream it's full. Something is doing laps, politely, in the dark. You wake before it reaches the wall. First and only dream sequence until Day 8; two static screens and text — restraint, always.

---

## 14. BACKLOG / STRETCH

- **Blessing of the Fleet flashback** (playable memory, July, full color and full mix — deployed once, mid-game, as an ache).
- WLNK call-in segment with procedural-ish town gossip that tracks player anomalies ("somebody's been leaving lights on in Black Rock…").
- Photo mode styled as a disposable camera — 24 exposures per run, developed only in the epilogue (whatever your ending, the photos come back… mostly as you shot them).
- The Station miniquest: Petey's plume observations resolve into exactly one rowboat trip you can refuse. Recommend refusing. Recommend the game making you want to say yes.
- New Game+: the Ledger remembers previous runs' entered names.
- Localization hooks (content JSON already keyed).

---

## 15. ONE-PAGE SUMMARY (PIN THIS)

Nine days. One town. One checklist with an illegible last line. You are the maintenance man for a rite disguised as a municipality: close the beach, drain the pool, haul the docks, kill the lights one section a night, count the living, and douse the Lantern so the town can go dark and cross the winter like a ship. A stowaway is aboard because grief made her miss the last exit, and every tool you have for saving her is also the tool that would surrender her: your keys, your log, your count, your standing as the one person whose job is to notice. The world gets quieter and wronger on a budget. The cats know first. The train stops stopping. And the Ledger — 200 names and one blank line at the bottom of every year's page — has been waiting, all along, for somebody to ask the only question that matters in a town like this: *not how do I hide her. How do I make her one of us.*

**Douse the Lantern. Mind the Slack. See you next summer.**
