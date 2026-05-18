import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
cur = db.cursor()
def q(sql):
    return cur.execute(sql).fetchone()[0]

print("=== Phase 3 D1 row counts ===")
for t in ['lore_articles', 'lore_meta_characters', 'lore_meta_locations', 'lore_meta_organizations', 'lore_meta_deities',
          'lore_secrets', 'lore_article_eras', 'lore_article_campaigns', 'lore_article_tags', 'lore_links',
          'lore_secret_eras', 'lore_secret_campaigns']:
    print(f"  {t:<32} {q(f'SELECT COUNT(*) FROM {t}')}")

print()
print("=== FK integrity ===")
checks = [
    ('articles bad parent_id', "SELECT COUNT(*) FROM lore_articles a LEFT JOIN lore_articles p ON a.parent_id=p.id WHERE a.parent_id IS NOT NULL AND p.id IS NULL"),
    ('articles bad author_id', "SELECT COUNT(*) FROM lore_articles a LEFT JOIN users u ON a.author_id=u.id WHERE a.author_id IS NOT NULL AND u.id IS NULL"),
    ('meta_chars w/o article', "SELECT COUNT(*) FROM lore_meta_characters m LEFT JOIN lore_articles a ON m.article_id=a.id WHERE a.id IS NULL"),
    ('meta_locs w/o article', "SELECT COUNT(*) FROM lore_meta_locations m LEFT JOIN lore_articles a ON m.article_id=a.id WHERE a.id IS NULL"),
    ('meta_orgs w/o article', "SELECT COUNT(*) FROM lore_meta_organizations m LEFT JOIN lore_articles a ON m.article_id=a.id WHERE a.id IS NULL"),
    ('meta_deities w/o article', "SELECT COUNT(*) FROM lore_meta_deities m LEFT JOIN lore_articles a ON m.article_id=a.id WHERE a.id IS NULL"),
    ('secrets w/o article', "SELECT COUNT(*) FROM lore_secrets s LEFT JOIN lore_articles a ON s.article_id=a.id WHERE a.id IS NULL"),
    ('article_eras bad article', "SELECT COUNT(*) FROM lore_article_eras j LEFT JOIN lore_articles a ON j.article_id=a.id WHERE a.id IS NULL"),
    ('article_eras bad era', "SELECT COUNT(*) FROM lore_article_eras j LEFT JOIN eras e ON j.era_id=e.id WHERE e.id IS NULL"),
    ('article_campaigns bad article', "SELECT COUNT(*) FROM lore_article_campaigns j LEFT JOIN lore_articles a ON j.article_id=a.id WHERE a.id IS NULL"),
    ('article_campaigns bad campaign', "SELECT COUNT(*) FROM lore_article_campaigns j LEFT JOIN campaigns c ON j.campaign_id=c.id WHERE c.id IS NULL"),
    ('article_tags bad article', "SELECT COUNT(*) FROM lore_article_tags j LEFT JOIN lore_articles a ON j.article_id=a.id WHERE a.id IS NULL"),
    ('article_tags bad tag', "SELECT COUNT(*) FROM lore_article_tags j LEFT JOIN tags t ON j.tag_id=t.id WHERE t.id IS NULL"),
    ('links bad article', "SELECT COUNT(*) FROM lore_links j LEFT JOIN lore_articles a ON j.article_id=a.id WHERE a.id IS NULL"),
    ('secret_eras bad secret', "SELECT COUNT(*) FROM lore_secret_eras j LEFT JOIN lore_secrets s ON j.secret_id=s.id WHERE s.id IS NULL"),
    ('secret_campaigns bad campaign', "SELECT COUNT(*) FROM lore_secret_campaigns j LEFT JOIN campaigns c ON j.campaign_id=c.id WHERE c.id IS NULL"),
]
for label, sql in checks:
    print(f"  {label:<35} {q(sql)}")

print()
print("=== Sample article inspection ===")
for row in cur.execute("SELECT id, title, slug, category, status, parent_id, author_id, length(content), length(coalesce(dm_notes,'')) FROM lore_articles").fetchall():
    print(f"  {row[1]} ({row[3]})")
    print(f"    id={row[0]}  slug={row[2]}  status={row[4]}")
    print(f"    parent={row[5] or '(none)'}  author={row[6] or '(none)'}")
    print(f"    content={row[7]} chars, dm_notes={row[8]} chars")
    metas = []
    for t in ['lore_meta_characters', 'lore_meta_locations', 'lore_meta_organizations', 'lore_meta_deities']:
        n = cur.execute(f'SELECT COUNT(*) FROM {t} WHERE article_id=?', (row[0],)).fetchone()[0]
        if n: metas.append(f"{t}({n})")
    print(f"    metadata: {', '.join(metas) if metas else '(none)'}")
    secrets = cur.execute("SELECT COUNT(*) FROM lore_secrets WHERE article_id=?", (row[0],)).fetchone()[0]
    print(f"    secrets: {secrets}")
