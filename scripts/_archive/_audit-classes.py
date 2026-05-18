import sqlite3, sys, json
db = sqlite3.connect(sys.argv[1])
cur = db.cursor()
def q(sql, *args):
    return cur.execute(sql, args).fetchone()[0]

print("=== Classes + Subclasses + Features + Scaling D1 audit ===")
print()
print(f"  classes               {q('SELECT COUNT(*) FROM classes')}")
print(f"  subclasses            {q('SELECT COUNT(*) FROM subclasses')}")
print(f"  features              {q('SELECT COUNT(*) FROM features')}")
print(f"  scaling_columns       {q('SELECT COUNT(*) FROM scaling_columns')}")
print()

print("--- FK integrity ---")
checks = [
    ('classes bad source_id',
        "SELECT COUNT(*) FROM classes c LEFT JOIN sources s ON c.source_id=s.id WHERE c.source_id IS NOT NULL AND s.id IS NULL"),
    ('classes with NULL source_id',
        "SELECT COUNT(*) FROM classes WHERE source_id IS NULL"),
    ('subclasses bad class_id',
        "SELECT COUNT(*) FROM subclasses sub LEFT JOIN classes c ON sub.class_id=c.id WHERE c.id IS NULL"),
    ('subclasses bad source_id',
        "SELECT COUNT(*) FROM subclasses sub LEFT JOIN sources s ON sub.source_id=s.id WHERE sub.source_id IS NOT NULL AND s.id IS NULL"),
    ('features bad parent (class)',
        "SELECT COUNT(*) FROM features f LEFT JOIN classes c ON f.parent_id=c.id WHERE f.parent_type='class' AND c.id IS NULL"),
    ('features bad parent (subclass)',
        "SELECT COUNT(*) FROM features f LEFT JOIN subclasses s ON f.parent_id=s.id WHERE f.parent_type='subclass' AND s.id IS NULL"),
    ('features unknown parent_type',
        "SELECT COUNT(*) FROM features WHERE parent_type NOT IN ('class', 'subclass') OR parent_type IS NULL"),
    ('features bad source_id',
        "SELECT COUNT(*) FROM features f LEFT JOIN sources s ON f.source_id=s.id WHERE f.source_id IS NOT NULL AND s.id IS NULL"),
    ('scaling bad parent (class)',
        "SELECT COUNT(*) FROM scaling_columns sc LEFT JOIN classes c ON sc.parent_id=c.id WHERE sc.parent_type='class' AND c.id IS NULL"),
    ('scaling bad parent (subclass)',
        "SELECT COUNT(*) FROM scaling_columns sc LEFT JOIN subclasses s ON sc.parent_id=s.id WHERE sc.parent_type='subclass' AND s.id IS NULL"),
    ('scaling unknown parent_type',
        "SELECT COUNT(*) FROM scaling_columns WHERE parent_type NOT IN ('class', 'subclass') OR parent_type IS NULL"),
]
for label, sql in checks:
    print(f"  {label:<35} {q(sql)}")
print()

print("--- Duplicate identifier check (post-Blade-of-Disaster paranoia) ---")
# Note: subclasses table has no `identifier` column; identity is `(class_id, name)`-driven
for label, sql in [
    ('classes (identifier)', "SELECT identifier, COUNT(*) FROM classes GROUP BY identifier HAVING COUNT(*) > 1"),
    ('subclasses (class_id, name)', "SELECT class_id || ':' || name as k, COUNT(*) FROM subclasses GROUP BY class_id, name HAVING COUNT(*) > 1"),
    ('features (identifier)', "SELECT identifier, COUNT(*) FROM features GROUP BY identifier HAVING COUNT(*) > 1"),
]:
    rows = cur.execute(sql).fetchall()
    if rows:
        print(f"  {label}: {len(rows)} dup(s)")
        for ident, n in rows[:5]:
            print(f"    {ident}: {n} copies")
    else:
        print(f"  {label}: no dups")
print()
print("--- Classes with NULL source_id (investigate) ---")
null_src = cur.execute("SELECT id, name, identifier FROM classes WHERE source_id IS NULL ORDER BY name").fetchall()
print(f"  {len(null_src)} classes with NULL source_id")
print("  First 15:")
for cid, name, ident in null_src[:15]:
    print(f"    {name:<30} ({ident or '?'}) id={cid}")
print()

print("--- Class spellcasting block reference audit ---")
classes = cur.execute("SELECT id, name, identifier, spellcasting FROM classes").fetchall()
type_ids_in_d1 = {row[0] for row in cur.execute("SELECT id FROM spellcasting_types").fetchall()}
prog_ids_in_d1 = {row[0] for row in cur.execute("SELECT id FROM spellcasting_progressions").fetchall()}
spellcasting_set = 0
type_refs = 0
spells_known_refs = 0
alt_prog_refs = 0
broken_type = []
broken_spells_known = []
broken_alt_prog = []
for cid, name, ident, sc_str in classes:
    if not sc_str: continue
    try:
        sc = json.loads(sc_str)
    except (json.JSONDecodeError, TypeError):
        continue
    if not isinstance(sc, dict) or len(sc) == 0: continue
    spellcasting_set += 1
    pid = sc.get('progressionId')        # → spellcasting_types (formula)
    skid = sc.get('spellsKnownId')       # → spellcasting_progressions (type='known')
    apid = sc.get('altProgressionId')    # → spellcasting_progressions (type='pact')
    if pid and pid != 'custom' and pid != 'none':
        type_refs += 1
        if pid not in type_ids_in_d1: broken_type.append((name, pid))
    if skid and skid != 'none':
        spells_known_refs += 1
        if skid not in prog_ids_in_d1: broken_spells_known.append((name, skid))
    if apid and apid != 'none':
        alt_prog_refs += 1
        if apid not in prog_ids_in_d1: broken_alt_prog.append((name, apid))

print(f"  classes with spellcasting block:           {spellcasting_set} / {len(classes)}")
print(f"  references to spellcasting_types:          {type_refs}  (broken: {len(broken_type)})")
print(f"  references to spells_known progressions:   {spells_known_refs}  (broken: {len(broken_spells_known)})")
print(f"  references to alt (pact) progressions:     {alt_prog_refs}  (broken: {len(broken_alt_prog)})")
for label, broken in [('broken_type', broken_type), ('broken_spells_known', broken_spells_known), ('broken_alt_prog', broken_alt_prog)]:
    if broken:
        print(f"  {label}:")
        for name, ref in broken[:5]: print(f"    {name} -> {ref}")
print()

print("--- Advancement JSON sanity (top-level shape) ---")
adv_total = 0
adv_with_items = 0
for row in cur.execute("SELECT id, name, advancements FROM classes").fetchall():
    if not row[2]: continue
    try:
        adv = json.loads(row[2])
    except (json.JSONDecodeError, TypeError):
        continue
    if isinstance(adv, list):
        adv_total += len(adv)
        if len(adv) > 0:
            adv_with_items += 1
print(f"  classes with non-empty advancements: {adv_with_items}")
print(f"  total advancement entries:           {adv_total}")
print()

print("--- Per-class summary (top 10 by feature count) ---")
for row in cur.execute("""
SELECT c.id, c.name, c.identifier, c.hit_die,
  (SELECT COUNT(*) FROM subclasses s WHERE s.class_id = c.id) as subclass_count,
  (SELECT COUNT(*) FROM features f WHERE f.parent_type='class' AND f.parent_id = c.id) as class_features,
  (SELECT COUNT(*) FROM features f WHERE f.parent_type='subclass' AND f.parent_id IN (SELECT id FROM subclasses WHERE class_id=c.id)) as subclass_features,
  (SELECT COUNT(*) FROM scaling_columns sc WHERE sc.parent_type='class' AND sc.parent_id = c.id) as class_scalings,
  src.abbreviation
FROM classes c
LEFT JOIN sources src ON c.source_id = src.id
ORDER BY (class_features + subclass_features) DESC
LIMIT 10
""").fetchall():
    print(f"  {row[1]:<22} ({row[8] or '-':>4})  d{row[3] or '?':<2} subs={row[4]:<2} cf={row[5]:<2} sf={row[6]:<3} scaling={row[7]}")
