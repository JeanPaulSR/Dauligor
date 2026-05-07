import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
cur = db.cursor()
def q(sql, *args):
    return cur.execute(sql, args).fetchone()[0]

print("=== Spells D1 row counts and schema ===")
print()
print(f"  spells total                           {q('SELECT COUNT(*) FROM spells')}")
print()

print("Schema columns:")
cols = cur.execute("PRAGMA table_info(spells)").fetchall()
for c in cols:
    flags = []
    if c[5]: flags.append('PK')
    if c[3]: flags.append('NOT NULL')
    flag = ' '.join(flags) if flags else ''
    print(f"  {c[1]:<32} {c[2]:<10} {flag}")
print(f"  ({len(cols)} columns total)")
print()

print("FK integrity:")
sql_bad_source = "SELECT COUNT(*) FROM spells s LEFT JOIN sources src ON s.source_id=src.id WHERE s.source_id IS NOT NULL AND src.id IS NULL"
print(f"  spells with bad source_id refs:        {q(sql_bad_source)}")
print(f"  spells with NULL source_id:            {q('SELECT COUNT(*) FROM spells WHERE source_id IS NULL')}")
print()

print("Distribution by level:")
for row in cur.execute("SELECT level, COUNT(*) as n FROM spells GROUP BY level ORDER BY level").fetchall():
    print(f"  level {row[0]}: {row[1]}")
print()

print("Distribution by school:")
for row in cur.execute("SELECT school, COUNT(*) as n FROM spells GROUP BY school ORDER BY n DESC").fetchall():
    print(f"  {row[0] or '(unset)':<14} {row[1]}")
print()

print("Distribution by source (top 10):")
for row in cur.execute("""
SELECT s.name, COUNT(sp.id) as n
FROM spells sp LEFT JOIN sources s ON sp.source_id=s.id
GROUP BY s.id ORDER BY n DESC LIMIT 10
""").fetchall():
    print(f"  {row[0] or '(no source)':<35} {row[1]}")
print()

print("Sample spells (first 5):")
for row in cur.execute("SELECT id, name, level, school, preparation_mode, ritual, concentration, source_id FROM spells ORDER BY level, name LIMIT 5").fetchall():
    print(f"  id={row[0]}")
    print(f"    name={row[1]:<25} L{row[2]} {row[3]:<12}")
    print(f"    prep={row[4]} ritual={row[5]} conc={row[6]}")
print()

print("JSON column inspection (sample):")
sample_id = cur.execute("SELECT id FROM spells LIMIT 1").fetchone()[0]
sample = cur.execute("SELECT activities, effects, foundry_data, tags FROM spells WHERE id=?", (sample_id,)).fetchone()
import json
for label, data in zip(['activities', 'effects', 'foundry_data', 'tags'], sample):
    if data:
        try:
            parsed = json.loads(data) if isinstance(data, str) else data
            kind = type(parsed).__name__
            size = len(parsed) if hasattr(parsed, '__len__') else 'N/A'
            print(f"  {label:<14} parses as {kind} (size={size})")
        except json.JSONDecodeError:
            print(f"  {label:<14} INVALID JSON ({len(data)} chars)")
    else:
        print(f"  {label:<14} (null/empty)")
