# Dauligor Advancement Construction Guide

This document explains how to create `dnd5e` advancements correctly.

It is meant to answer questions like:

- "What is an advancement in Foundry?"
- "Which item should own the advancement?"
- "What goes in `configuration` versus `value`?"
- "How should class features, subclass features, and actor level-up choices be modeled?"

This guide is especially focused on classes and class features, but it also documents the general advancement families available in `dnd5e` `5.3.1`.

Use this alongside:

- `docs/class-import-contract.md`
- `docs/class-import-and-advancement-guide.md`
- `docs/class-feature-activity-contract.md`
- `docs/character-class-import-guide.md`


## Contents

Detailed material is split into parts under [`advancement-construction/`](advancement-construction/):

- [Advancement Object Shape & Fields](advancement-construction/object-and-fields.md) — where advancements belong, the object shape, field meanings, `configuration` vs `value`
- [General Advancement Families](advancement-construction/advancement-families.md) — HitPoints, Trait, ScaleValue, ItemGrant, ItemChoice, AbilityScoreImprovement, Size, Subclass
- [Class Advancement Trees & Features](advancement-construction/class-trees-and-features.md)
- [World Items, Actor Items & Persistence](advancement-construction/world-vs-actor-persistence.md)
- [Dauligor Contract, Sequence & Pitfalls](advancement-construction/dauligor-contract-and-sequence.md) — semantic contract, import/level-up sequence, common pitfalls, checklists

The Scope and Core Mental Model below orient you first.

## Scope

This guide covers:

- the general `dnd5e` advancement model
- the advancement families currently present in `dnd5e` `5.3.1`
- where advancements belong for classes, subclasses, and class features
- how actor-specific advancement state should be persisted
- what the app should express semantically versus what the Foundry module should synthesize
- the current class/subclass contract now used by Dauligor export and import

This guide does not finalize:

- spell importer specifics outside class/subclass scope
- species/background-only advancement authoring
- every possible edge case for homebrew content

## The Core Mental Model

An advancement is not a standalone document.

An advancement is a row inside an item's `system.advancement` object.

That means:

- advancements live on an item
- the item owns the progression tree
- the actor stores advancement choices by embedding that item

For class-driven character creation, the important owner items are:

- the class item
- the subclass item

The important non-owner items are:

- class feature feat items
- subclass feature feat items
- optional feature feat items

Those feature items can contain:

- descriptions
- activities
- effects
- limited uses
- references

But they usually should not own the main class progression logic.

The class or subclass item should own the advancement rows that decide:

- when a feature is granted
- how many cantrips or spells are known
- how many sorcery points exist
- which skills were chosen
- how HP was gained by level
- when a subclass is selected

In the current Dauligor pipeline, this is no longer just a recommendation.

The working contract is:

- the app exports root `class.advancements`
- the app exports root `subclass.advancements`
- the exporter synthesizes inherent class/subclass `ItemGrant` rows for core features by level
- the module imports those root advancement rows directly
- actor import applies the resulting `Trait` advancements back onto the actor root for saves, skills, tools, armor, weapons, and languages


## Relationship To Character Importing

If character importing is class-focused, then advancement state is the backbone of the actor import.

That means:

- class items define the progression
- subclass items define subclass progression
- feature items define behavior
- advancement `value` defines what the actor actually chose

Without that layer, the actor becomes much harder to reimport, level, audit, or export.

## Related Documents

- `docs/class-import-contract.md`
- `docs/class-import-and-advancement-guide.md`
- `docs/class-feature-activity-contract.md`
- `docs/character-class-import-guide.md`
