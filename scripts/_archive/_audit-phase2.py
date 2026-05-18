import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
cur = db.cursor()
def q(sql):
    return cur.execute(sql).fetchone()[0]

print("=== Phase 2 D1 row counts and FK integrity ===")
print()
print(f"  eras                                {q('SELECT COUNT(*) FROM eras')}")
print(f"  users                               {q('SELECT COUNT(*) FROM users')}")
print(f"  campaigns                           {q('SELECT COUNT(*) FROM campaigns')}")
print(f"  campaign_members                    {q('SELECT COUNT(*) FROM campaign_members')}")
print()
print("FK integrity:")
print(f"  campaigns w/ bad dm_id:             {q('SELECT COUNT(*) FROM campaigns c LEFT JOIN users u ON c.dm_id=u.id WHERE c.dm_id IS NOT NULL AND u.id IS NULL')}")
print(f"  campaigns w/ bad era_id:            {q('SELECT COUNT(*) FROM campaigns c LEFT JOIN eras e ON c.era_id=e.id WHERE c.era_id IS NOT NULL AND e.id IS NULL')}")
print(f"  campaign_members bad campaign_id:   {q('SELECT COUNT(*) FROM campaign_members m LEFT JOIN campaigns c ON m.campaign_id=c.id WHERE c.id IS NULL')}")
print(f"  campaign_members bad user_id:       {q('SELECT COUNT(*) FROM campaign_members m LEFT JOIN users u ON m.user_id=u.id WHERE u.id IS NULL')}")
print(f"  users w/ bad active_campaign_id:    {q('SELECT COUNT(*) FROM users u LEFT JOIN campaigns c ON u.active_campaign_id=c.id WHERE u.active_campaign_id IS NOT NULL AND c.id IS NULL')}")
print()
print("snake_case sanity (column existence, sample):")
cols = [r[1] for r in cur.execute("PRAGMA table_info(users)").fetchall()]
expected = ['id','username','display_name','role','avatar_url','bio','pronouns','theme','accent_color','hide_username','is_private','recovery_email','active_campaign_id','created_at','updated_at']
missing = [c for c in expected if c not in cols]
extra = [c for c in cols if c not in expected]
print(f"  users columns:                      {len(cols)} present, {len(missing)} missing, {len(extra)} extra")
if missing: print(f"    MISSING: {missing}")
if extra:   print(f"    EXTRA:   {extra}")
print()
print("Membership breakdown:")
for row in cur.execute("SELECT role, COUNT(*) FROM campaign_members GROUP BY role").fetchall():
    print(f"    {row[0]:<10} {row[1]}")
print()
print("Per-campaign membership:")
for row in cur.execute("""
SELECT c.name, COUNT(m.user_id) as members,
  SUM(CASE WHEN m.role='dm' THEN 1 ELSE 0 END) as dms,
  SUM(CASE WHEN m.role='player' THEN 1 ELSE 0 END) as players
FROM campaigns c LEFT JOIN campaign_members m ON c.id=m.campaign_id
GROUP BY c.id ORDER BY c.name
""").fetchall():
    print(f"  {row[0]:<25} total={row[1]} (dm={row[2]}, player={row[3]})")
