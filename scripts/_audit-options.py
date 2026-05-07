import sqlite3, sys, json
db = sqlite3.connect(sys.argv[1])
cur = db.cursor()
def q(sql, *args):
    return cur.execute(sql, args).fetchone()[0]

print("=== Unique Option Groups + Items D1 audit ===")
print()
print(f"  unique_option_groups   {q('SELECT COUNT(*) FROM unique_option_groups')}")
print(f"  unique_option_items    {q('SELECT COUNT(*) FROM unique_option_items')}")
print()

print("Schema — unique_option_groups:")
for c in cur.execute("PRAGMA table_info(unique_option_groups)").fetchall():
    flag = ('PK' if c[5] else '') + (' NOT NULL' if c[3] else '')
    print(f"  {c[1]:<26} {c[2]:<10} {flag}")
print()

print("Schema — unique_option_items:")
for c in cur.execute("PRAGMA table_info(unique_option_items)").fetchall():
    flag = ('PK' if c[5] else '') + (' NOT NULL' if c[3] else '')
    print(f"  {c[1]:<26} {c[2]:<10} {flag}")
print()

print("FK integrity (column-level):")
sql_bad_grp_src = "SELECT COUNT(*) FROM unique_option_groups g LEFT JOIN sources s ON g.source_id=s.id WHERE g.source_id IS NOT NULL AND s.id IS NULL"
sql_bad_item_grp = "SELECT COUNT(*) FROM unique_option_items i LEFT JOIN unique_option_groups g ON i.group_id=g.id WHERE i.group_id IS NOT NULL AND g.id IS NULL"
sql_bad_item_src = "SELECT COUNT(*) FROM unique_option_items i LEFT JOIN sources s ON i.source_id=s.id WHERE i.source_id IS NOT NULL AND s.id IS NULL"
print(f"  groups with bad source_id refs:        {q(sql_bad_grp_src)}")
print(f"  items with bad group_id refs:          {q(sql_bad_item_grp)}")
print(f"  items with bad source_id refs:         {q(sql_bad_item_src)}")
print()

print("FK integrity (JSON `class_ids` columns — these aren't enforced, scan manually):")
class_ids_set = {row[0] for row in cur.execute("SELECT id FROM classes").fetchall()}

bad_group_class = []
for row in cur.execute("SELECT id, name, class_ids FROM unique_option_groups").fetchall():
    if not row[2]: continue
    try:
        ids = json.loads(row[2])
    except (json.JSONDecodeError, TypeError):
        continue
    if not isinstance(ids, list): continue
    invalid = [c for c in ids if c not in class_ids_set]
    if invalid:
        bad_group_class.append((row[0], row[1], invalid))

bad_item_class = []
for row in cur.execute("SELECT id, name, class_ids FROM unique_option_items").fetchall():
    if not row[2]: continue
    try:
        ids = json.loads(row[2])
    except (json.JSONDecodeError, TypeError):
        continue
    if not isinstance(ids, list): continue
    invalid = [c for c in ids if c not in class_ids_set]
    if invalid:
        bad_item_class.append((row[0], row[1], invalid))

print(f"  groups with bad class_ids JSON refs:   {len(bad_group_class)}")
for g in bad_group_class[:5]:
    print(f"    {g[0]:<24} {g[1]:<28} bad={g[2]}")
print(f"  items with bad class_ids JSON refs:    {len(bad_item_class)}")
for i in bad_item_class[:5]:
    print(f"    {i[0]:<24} {i[1]:<28} bad={i[2]}")
print()

print("All groups (with item counts):")
for row in cur.execute("""
SELECT g.id, g.name, s.abbreviation as src, COUNT(i.id) as items, g.class_ids
FROM unique_option_groups g
LEFT JOIN unique_option_items i ON i.group_id=g.id
LEFT JOIN sources s ON g.source_id=s.id
GROUP BY g.id ORDER BY g.name
""").fetchall():
    cids = []
    if row[4]:
        try:
            cids = json.loads(row[4]) if isinstance(row[4], str) else row[4]
        except: pass
    cls_label = f" classes=[{','.join(cids)}]" if cids else " classes=any"
    print(f"  {row[1]:<28} ({row[2] or '-':>4})  {row[3]:>3} items{cls_label}")
print()

print("Items distribution by group:")
for row in cur.execute("""
SELECT g.name, COUNT(i.id) as n,
       SUM(CASE WHEN i.is_repeatable=1 THEN 1 ELSE 0 END) as repeatable,
       SUM(CASE WHEN i.level_prerequisite>0 THEN 1 ELSE 0 END) as level_gated
FROM unique_option_groups g
LEFT JOIN unique_option_items i ON i.group_id=g.id
GROUP BY g.id ORDER BY n DESC
""").fetchall():
    print(f"  {row[0]:<28} total={row[1]:>3} repeatable={row[2] or 0:>2} level_gated={row[3] or 0:>2}")
