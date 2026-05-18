import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
cur = db.cursor()
def q(sql):
    return cur.execute(sql).fetchone()[0]

print("=== Feats + Items D1 row counts ===")
for t in ['feats', 'items']:
    print(f"  {t:<20} {q(f'SELECT COUNT(*) FROM {t}')}")

print()
print("=== Schema columns ===")
for t in ['feats', 'items']:
    cols = cur.execute(f"PRAGMA table_info({t})").fetchall()
    print(f"  {t} ({len(cols)} columns):")
    for c in cols:
        # cid, name, type, notnull, dflt_value, pk
        flags = []
        if c[5]: flags.append('PK')
        if c[3]: flags.append('NOT NULL')
        flag = ' '.join(flags) if flags else ''
        print(f"    {c[1]:<28} {c[2]:<10} {flag}")
    print()

print("=== FK integrity (source_id refs) ===")
for t in ['feats', 'items']:
    bad = q(f"SELECT COUNT(*) FROM {t} x LEFT JOIN sources s ON x.source_id=s.id WHERE x.source_id IS NOT NULL AND s.id IS NULL")
    print(f"  {t} bad source_id refs: {bad}")
