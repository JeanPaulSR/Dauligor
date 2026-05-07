# Foundry dnd5e Character Reference Sheet

This note is a working reference for how `dnd5e` exposes character data on sheets and in formula / roll-data paths.

## Core Rule

Use two different path styles depending on context:

- Sheet / document data path:
  - `system.abilities.int.value`
- Formula / roll-data path:
  - `@abilities.int.value`

Important:

- Do not prefix formula paths with `system.`
- Intelligence is under `abilities`, not `attributes`
- So use `@abilities.int.mod`, not `@attributes.int.mod`

## Where This Comes From

Confirmed in `dnd5e` source:

- Actor roll data comes from the actor system `getRollData()` and is returned at the formula root:
  - [dnd5e.mjs](C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:36478)
  - [dnd5e.mjs](C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:26389)
- Character roll data explicitly adds `classes` and `subclasses`:
  - [dnd5e.mjs](C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:71701)
- Ability derived fields are prepared onto `abilities.*`:
  - [dnd5e.mjs](C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:26530)
- Skill derived fields are prepared onto `skills.*`:
  - [dnd5e.mjs](C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:71585)
- Tool derived fields are prepared onto `tools.*`:
  - [dnd5e.mjs](C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:71680)
- Character level and proficiency are prepared from class items:
  - [dnd5e.mjs](C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:71876)

## Confirmed Formula Namespaces

These are safe namespaces to plan around for character formulas:

- `@abilities`
- `@attributes`
- `@details`
- `@skills`
- `@tools`
- `@classes`
- `@subclasses`
- `@flags`
- `@name`
- `@statuses`

When rolling from an item or activity, you also get:

- `@item`
- `@activity`

Confirmed item / activity roll-data layering:

- [dnd5e.mjs](C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:23711)
- [dnd5e.mjs](C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:17813)

## Common Ability References

Sheet paths:

- `system.abilities.str.value`
- `system.abilities.int.value`
- `system.abilities.wis.proficient`

Formula paths:

- `@abilities.str.value`
- `@abilities.int.mod`
- `@abilities.dex.save.value`
- `@abilities.wis.attack`
- `@abilities.cha.dc`
- `@abilities.con.checkBonus`
- `@abilities.dex.saveBonus`

Confirmed prepared ability fields include:

- `value`
- `mod`
- `proficient`
- `checkBonus`
- `saveBonus`
- `attack`
- `dc`
- `save.value`

## Common Attribute References

Sheet paths:

- `system.attributes.prof`
- `system.attributes.hp.value`
- `system.attributes.hp.max`
- `system.attributes.ac.value`
- `system.attributes.spell.dc`
- `system.attributes.spell.attack`
- `system.attributes.senses.ranges.darkvision`

Formula paths:

- `@attributes.prof`
- `@attributes.hp.value`
- `@attributes.hp.max`
- `@attributes.ac.value`
- `@attributes.ac.armor`
- `@attributes.ac.shield`
- `@attributes.ac.bonus`
- `@attributes.spell.dc`
- `@attributes.spell.attack`
- `@attributes.spell.level`
- `@attributes.senses.ranges.darkvision`

Good native examples from the system:

- `13 + @abilities.dex.mod`
- `10 + @abilities.dex.mod + @abilities.wis.mod`
- `@attributes.ac.armor`

Source examples:

- [dnd5e.mjs](C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:45098)
- [dnd5e.mjs](C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:45106)
- [dnd5e.mjs](C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:26501)

## Details References

Sheet paths:

- `system.details.level`
- `system.details.xp.value`

Formula paths:

- `@details.level`
- `@details.cr`
- `@details.xp.value`

Character level and proficiency preparation:

- [dnd5e.mjs](C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:71876)

## Skill References

Sheet paths:

- `system.skills.arc.value`
- `system.skills.arc.mod`
- `system.skills.arc.total`
- `system.skills.prc.passive`

Formula paths:

- `@skills.arc.value`
- `@skills.arc.mod`
- `@skills.arc.bonus`
- `@skills.arc.total`
- `@skills.prc.passive`

Confirmed prepared skill fields include:

- `ability`
- `value`
- `bonus`
- `mod`
- `prof`
- `total`
- `passive`

## Tool References

Sheet paths:

- `system.tools.thief.value`
- `system.tools.thief.mod`
- `system.tools.thief.total`

Formula paths:

- `@tools.thief.value`
- `@tools.thief.mod`
- `@tools.thief.bonus`
- `@tools.thief.total`

Confirmed prepared tool fields include:

- `ability`
- `value`
- `bonus`
- `mod`
- `prof`
- `total`

## Class And Subclass References

Character roll data adds classes and subclasses like this:

- `@classes.<classIdentifier>.levels`
- `@classes.<classIdentifier>.hitDice`
- `@classes.<classIdentifier>.subclass`
- `@subclasses.<subclassIdentifier>.levels`

Important:

- these keys use identifiers, not display names
- example class key: `druid`
- example subclass key: `moon`

Confirmed native examples from `dnd5e`:

- `max(@classes.druid.levels, @subclasses.moon.levels * 3)`
- `(13 + @abilities.wis.mod) * sign(@subclasses.moon.levels)`

Source:

- [dnd5e.mjs](C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:47014)
- [dnd5e.mjs](C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:47016)

## Status References

Actor roll data also adds:

- `@name`
- `@flags`
- `@statuses.exhaustion`
- `@statuses.concentrating`

Source:

- [dnd5e.mjs](C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:36482)

## Safe Shortlist For Dauligor

These are the most useful references to support early in Dauligor authoring:

- `@abilities.<ability>.mod`
- `@abilities.<ability>.save.value`
- `@attributes.prof`
- `@attributes.spell.dc`
- `@attributes.spell.attack`
- `@details.level`
- `@skills.<skill>.total`
- `@skills.<skill>.passive`
- `@tools.<tool>.total`
- `@classes.<identifier>.levels`
- `@subclasses.<identifier>.levels`

## First Validation Rule For App Work

When Dauligor authors enter a formula:

1. prefer the native roll-data path
2. store or display the matching sheet path beside it when useful
3. validate against this file before inventing a new namespace
