# Correcting Character Creation

This note is about the direction the app should take for character creation and character export when the current scope is:

- classes
- subclasses
- class features
- subclass features
- class advancement state

It is not trying to define every possible actor field.

The goal is to define:

- what should be treated as true build data
- what should be treated as derived output
- what the actor export should contain
- how class and subclass state should be preserved
- how references should be written so the module and Foundry can understand them consistently

## The Main Problem With The Current Character Export

The current export is actor-root heavy and class-light.

That makes it easy to serialize a sheet snapshot, but it is a weak foundation for:

- reimport
- level-up continuation
- subclass continuation
- HP history
- saved class choices
- class-driven character creation

The character export you shared has three big issues:

### 1. It exports a mostly empty actor shell without embedded class state

The payload currently has:

- `actor`
- `items: []`

That means the export does not actually contain the class/subclass/feature structure that Foundry `dnd5e` expects to drive character progression.

For class-focused character creation, the important data is not just the actor root.

It is primarily:

- embedded class items
- embedded subclass items
- embedded feature items
- class advancement state

### 2. It exports too many derived fields as if they were primary truth

Examples from the current actor root:

- `system.attributes.hp.max`
- `system.attributes.prof`
- `system.skills.*.value`

Those are often better treated as synchronized results of class state, not the primary source of truth.

If the app exports them as hard truth without also exporting the class state that explains them, the module has no reliable way to continue the build later.

### 3. The skill keys are not valid Foundry `dnd5e` keys

The current payload uses keys like:

- `5l9`
- `6VC`
- `FjM`

Foundry does not recognize those as canonical skill ids.

For `dnd5e`, skills should use native keys like:

- `acr`
- `arc`
- `ath`
- `dec`
- `ins`
- `itm`
- `per`
- `rel`

or the app should avoid exporting root skill proficiencies as primary truth and let class `Trait` advancements drive them.

## The Core Direction

The app should move toward a class-centric character export.

That means:

- the actor root is the shell
- embedded class items are the main build truth
- embedded subclass items are linked secondary truth
- embedded feature items are granted content
- advancement state is what makes the build resumable

This matches the rules already laid out in:

- [character-class-import-guide.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/character-class-import-guide.md)
- [class-import-and-advancement-guide.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/class-import-and-advancement-guide.md)
- [advancement-construction-guide.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/advancement-construction-guide.md)

## The Character Export Should Be Thought Of As Four Layers

### 1. Actor shell

This is the root actor document.

It should carry:

- name
- type
- image
- biography-like text
- ability scores
- size
- currency
- other actor-root facts that are not derived from class progression

### 2. Class package

For each class on the character, export:

- the embedded class item
- its semantic identity
- its level
- its advancement tree
- its advancement state

### 3. Subclass package

If the class has a subclass selected, export:

- the embedded subclass item
- its semantic identity
- its link back to the parent class
- its advancement tree

### 4. Granted features package

Export the embedded feature items that the class or subclass has actually granted.

Those feature items should carry:

- stable semantic ids
- descriptions
- activities
- uses
- effects

## What The Actor Root Should Contain

These are good candidates for actor-root truth:

- `actor.name`
- `actor.type`
- `actor.img`
- `system.abilities.<ability>.value`
- `system.details.biography`
- `system.details.alignment`
- `system.traits.size`
- `system.currency`

These are usually safer as derived or synchronized fields, not primary build truth:

- `system.details.level`
- `system.attributes.prof`
- `system.attributes.hp.max`
- `system.attributes.spellcasting`
- `system.skills.<skill>.value`
- `system.abilities.<ability>.proficient`

The reason is simple:

- class items and class advancements are what explain why the actor has those values
- if we only export the actor root snapshot, we lose the explanation

## What Must Be Exported For Classes

For each class on the character, the export should eventually preserve:

- class semantic identity
- app record identity
- source/book identity
- current class level
- class advancement tree
- class advancement values

That means each class package should be able to answer:

1. what class is this
2. what level is it
3. what subclass is selected
4. what class choices were made
5. what features were granted

## What Must Be Exported For Advancements

Character creation is where advancement state really matters.

For classes and subclasses, the export should preserve at least:

### HitPoints

This is the per-level HP history.

Example:

```json
{
  "1": "max",
  "2": 4,
  "3": 5
}
```

This is better than only exporting:

- `system.attributes.hp.max`

because it lets Foundry and the module understand how the HP was built.

### Trait

This is where class choices like skill proficiencies should live.

Important saved data:

```json
{
  "chosen": ["skills:arc", "skills:ins"]
}
```

This is the history the character creator needs.

### ItemGrant

This should preserve which granted feature items were actually embedded.

Important saved data:

```json
{
  "added": {
    "someEmbeddedItemId": "Actor...Item..."
  }
}
```

### ItemChoice

This matters for things like:

- Metamagic
- Fighting Style
- similar option-pool selections

The character export should preserve the selected items, not just the fact that a choice existed.

## What The Current Export Is Missing

Compared to the target direction, the current export is missing:

- embedded class items
- embedded subclass items
- embedded class and subclass features
- class advancement state
- subclass advancement state
- saved HP history
- saved class skill choices
- saved option-group choices

So while it is technically a character-shaped payload, it is not yet a usable class-driven character bundle.

## The Skill Problem

The current export has:

```json
"skills": {
  "5l9": { "value": 0, "ability": "cha" }
}
```

That is not a stable or Foundry-recognized skill structure.

The app should move toward one of these models:

### Better short-term model

Use Foundry-native skill keys:

```json
"skills": {
  "arc": { "value": 1, "ability": "int" },
  "ins": { "value": 1, "ability": "wis" }
}
```

### Best long-term model

Treat root skill proficiency as synchronized output and preserve the real class choice in class `Trait.value.chosen`.

That way the actor root tells us the current result, while the class advancement tells us why the actor has it.

## References Should Use Our Reference Guide

Character creation should not invent a separate reference syntax.

It should use the same semantic references defined in:

- [reference-syntax-guide.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/reference-syntax-guide.md)

That means the app should prefer references like:

- `@prof`
- `@level`
- `@ability.cha.mod`
- `@attr.hp.max`
- `@class.sorcerer.level`
- `@class.sorcerer.hit-die`
- `@scale.sorcerer.sorcery-points`
- `@feature[class-feature-font-of-magic]{Font of Magic}`

and not:

- raw Foundry UUIDs
- random internal ids
- Foundry-specific formula paths as the app’s only source format

## Why This Matters For Characters

Characters are where references become most important in practice.

Examples:

- feature descriptions
- activity formulas
- scaling references
- HP helper formulas
- resource descriptions

If the app uses the same semantic reference syntax everywhere:

- the site can render it consistently
- the exporter can preserve it consistently
- the module can normalize it consistently into Foundry

## Character Creation Should Reuse Class And Scale References

For class-driven characters, these are especially important:

### Class references

- `@class.sorcerer.level`
- `@class.sorcerer.hit-die`
- `@class.sorcerer.hit-die-faces`

### Scale references

- `@scale.sorcerer.sorcery-points`
- `@scale.sorcerer.metamagic`
- `@scale.sorcerer.cantrips-known`
- `@scale.sorcerer.spells-known`

### Actor-root references

- `@prof`
- `@level`
- `@ability.cha.mod`
- `@attr.hp.max`

These should be the first-wave reference surface for character creation too.

## Recommended Character Payload Direction

The app should move toward something like this:

```json
{
  "kind": "dauligor.actor-bundle.v1",
  "schemaVersion": 1,
  "source": {
    "system": "dauligor",
    "entity": "character",
    "id": "character-test-character"
  },
  "actor": {
    "name": "Test Character",
    "type": "character",
    "img": "icons/svg/mystery-man.svg",
    "flags": {
      "dauligor-pairing": {
        "sourceId": "character-test-character",
        "entityKind": "character",
        "schemaVersion": 1
      }
    },
    "system": {
      "abilities": {
        "str": { "value": 10 },
        "dex": { "value": 10 },
        "con": { "value": 10 },
        "int": { "value": 10 },
        "wis": { "value": 10 },
        "cha": { "value": 10 }
      },
      "details": {
        "biography": {
          "value": ""
        }
      },
      "traits": {
        "size": "med"
      }
    }
  },
  "items": [
    {
      "type": "class"
    },
    {
      "type": "subclass"
    },
    {
      "type": "feat"
    }
  ]
}
```

This is not meant to be the final exact endpoint.

It is the direction:

- actor shell plus class state
- not actor snapshot alone

## Recommended Order For Character Import

The import order should be:

1. create or upsert actor shell
2. embed class items
3. embed subclass items
4. embed granted feature items
5. persist advancement state on the class items
6. synchronize derived actor-root fields if needed

That order matters because the actor root is not enough to explain the class build.

## Practical Next Steps For The App

### Phase 1

Fix the root identity and semantic shape:

- stable character `sourceId`
- stable class and subclass identity
- no random skill keys

### Phase 2

Start exporting embedded class/subclass items:

- class
- subclass
- class features
- subclass features

### Phase 3

Start exporting advancement state:

- HP history
- skill choices
- item grants
- item choices

### Phase 4

Adopt semantic references from `reference-syntax-guide.md` across:

- feature descriptions
- formulas
- class helper text
- activity fields

## Bottom Line

The current export is useful as a rough actor shell, but it is not yet a good character-creation contract.

The direction should be:

- actor shell as the wrapper
- class and subclass items as the true build state
- advancement values as the saved progression history
- semantic references from `reference-syntax-guide.md` as the shared language between the app and Foundry

That will make character creation, reimport, and future level-up flows much more stable.
