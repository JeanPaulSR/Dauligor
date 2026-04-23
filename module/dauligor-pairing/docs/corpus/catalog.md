# Corpus Catalog

This file defines the research corpus we want to build.

For each category, collect three files whenever possible:

1. source-side 5etools or app-side JSON
2. Plutonium-imported Foundry dump
3. Foundry-native or manually created Foundry dump

## Player-Facing Items

### Weapons

- simple melee weapon
- martial melee weapon
- ranged weapon
- versatile weapon
- magical weapon with bonus
- weapon with ammunition behavior

### Armor and Equipment

- light armor
- medium armor
- heavy armor
- shield
- magical armor requiring attunement

### Consumables

- potion
- scroll
- ammunition
- charge-based consumable
- consumable with auto-destroy

### Tools

- artisan tool
- musical instrument
- gaming set
- magical tool

### Loot and Wondrous Items

- mundane loot
- trade good
- wondrous item
- attunement wondrous item
- loot with embedded effect or use action

### Containers

- backpack
- container with capacity behavior

## Features and Character Content

### Feats and Features

- general feat
- origin/background feat
- class feature represented as feat item
- subclass feature represented as feat item
- feat with prerequisites
- repeatable feat

### Spells

- cantrip
- leveled spell
- healing spell
- attack spell
- save spell
- concentration spell
- ritual spell
- spell with material cost

### Classes and Subclasses

- class with no spellcasting
- class with spellcasting
- subclass linked to class
- class with advancement-heavy progression
- class/subclass pair imported by Plutonium

### Advancements

- scale value advancement
- hit points advancement
- item grant advancement
- item choice advancement
- subclass advancement
- trait advancement

## Actors

### Characters

- low-level character
- multiclass character
- spellcaster character
- character with embedded magic items

### NPCs / Monsters

- simple melee monster
- spellcasting monster
- monster with recharge action
- monster with legendary or special actions if available

## World Content

### Journals

- plain journal entry
- class-related journal
- rulebook-style journal page if available

### Other Optional Types

- roll table
- background
- race or species

### Active Effects

- actor effect that adds or overrides a value
- item effect used by an enchantment or use action
- timed effect with duration
- status-based effect

## For each captured example, record

- category
- source book
- source-side identifier
- Foundry document type
- item or actor subtype
- important `system` fields
- important `system.activities`
- uses and recovery behavior
- effects
- chat-card behavior notes
- flags/source tracking
- notes about what was synthesized versus directly copied
