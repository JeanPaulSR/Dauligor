# Dauligor Contract, Sequence & Pitfalls

> Part of the [Advancement Construction Guide](../advancement-construction-guide.md).

## Recommended Dauligor Semantic Contract For Advancements

The app does not need to emit raw Foundry-local `_id` values as its source of truth.

The app should describe advancements semantically.

Recommended semantic shape:

```json
{
  "sourceAdvancementId": "classSorcererHitPoints",
  "type": "HitPoints",
  "level": 1,
  "title": "Hit Points",
  "configuration": {},
  "semantic": {
    "kind": "classHitPoints"
  }
}
```

Another example:

```json
{
  "sourceAdvancementId": "classSorcererSkills",
  "type": "Trait",
  "level": 1,
  "title": "Skills",
  "configuration": {
    "mode": "default",
    "allowReplacements": false,
    "grants": [],
    "choices": [
      {
        "count": 2,
        "pool": [
          "skills:arc",
          "skills:dec",
          "skills:ins",
          "skills:itm",
          "skills:per",
          "skills:rel"
        ]
      }
    ]
  }
}
```

The module should then:

- generate the actor-safe `_id`
- preserve `sourceAdvancementId` in flags
- attach or preserve `value` state during import/reimport

## Correct Import and Level-Up Sequence

For class-focused character creation, the advancement flow should look like this:

1. normalize the class and subclass into Foundry items
2. construct the class advancement tree
3. embed the class item on the actor
4. embed the subclass item if selected
5. gather only the choices for newly gained levels
6. write those choices into advancement `value`
7. embed the granted features/options
8. write `ItemGrant.value.added` and `ItemChoice.value`
9. update actor root data from the advancement results

The important order rule is:

- actor root data should be downstream of the class item advancement state

Not the other way around.

## Common Pitfalls

### Pitfall 1: putting class progression on the feature item

Wrong:

- Font of Magic feat owns the logic for when sorcery points appear

Better:

- Sorcerer class owns the `ScaleValue` and `ItemGrant`
- Font of Magic feat owns description and activities

> The "ScaleValue lives on the class" guidance above still holds for
> *class progression* tracks like sorcery points or cantrips known —
> those are conceptually class-scoped. The "advancements outside
> classes" track (Phase A/B, May 2026) generalized the *underlying*
> `scaling_columns` table so a homebrew feat / race / background /
> item can own its own scaling progression when it isn't class-scoped
> (e.g. "Bloodlust Rage Die" on a feat, "Channel Divinity Bonus" on
> Amulet of the Devout). The two patterns don't conflict.

### Pitfall 2: saving choices on the actor but not on the class item

Wrong:

- actor gets Arcana and Insight
- class `Trait.value.chosen` remains empty

Better:

- `Trait.value.chosen` stores the class decision
- actor skills are updated from that decision

### Pitfall 3: using actor HP max as the only HP history

Wrong:

- actor `hp.max` becomes 17
- `HitPoints.value` remains empty

Better:

- `HitPoints.value` stores `"1": "max", "2": 5, "3": 6`
- actor HP total is updated from that stored history

### Pitfall 4: unstable advancement ids on the actor

Wrong:

- each reimport generates new advancement ids

Better:

- preserve semantic ids in flags
- reuse or map stable actor-local ids across reimports

### Pitfall 5: subclass selection as only a temporary UI decision

Wrong:

- the importer remembers subclass only during the wizard
- the class/subclass items do not persist the decision meaningfully

Better:

- subclass selection becomes part of advancement or stored class state
- later level-up can continue from that decision

## Practical Checklists

### Advancement construction checklist

- advancement row has the right `type`
- advancement row has a stable semantic identity in flags
- level is correct for the owning progression
- `configuration` expresses the static rule
- `value` is empty for world blueprints unless there is intentional default state

### Actor import checklist

- embedded advancement ids are Foundry-safe
- HP choices are written into `HitPoints.value`
- skill choices are written into `Trait.value.chosen`
- granted features are written into `ItemGrant.value.added`
- item choices are written into `ItemChoice.value`
- actor root data is updated from those saved choices

### Class feature checklist

- feature itself is a `feat` item
- feature activities and effects live on the feat item
- grant timing lives on the class or subclass advancement tree
- option groups use `ItemChoice` or another advancement pattern, not only wizard-local memory

