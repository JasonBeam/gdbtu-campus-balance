"""Campus-only history. Never invent provider timestamps or import demo rows."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3

from campus import now, provider_time


class Journal:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(descriptor)
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS observations (id INTEGER PRIMARY KEY, metric TEXT, value REAL, providerAt TEXT, observedAt TEXT, source TEXT, state TEXT, fingerprint TEXT UNIQUE)')

    def connect(self):
        return sqlite3.connect(self.path, timeout=5)

    def record(self, snapshot):
        if snapshot.get('demo'):
            return 0
        added = 0
        with self.connect() as db:
            for key in ('power', 'card'):
                m = snapshot.get('metrics', {}).get(key, {})
                if m.get('state') != 'queried' or not provider_time(m.get('providerAt')):
                    continue
                identity = json.dumps([key, m['value'], m['providerAt'], 'school'])
                fingerprint = hashlib.sha256(identity.encode()).hexdigest()
                cursor = db.execute('INSERT OR IGNORE INTO observations(metric,value,providerAt,observedAt,source,state,fingerprint) VALUES(?,?,?,?,?,?,?)',
                                   (key, m['value'], m['providerAt'], m.get('fetchedAt') or now(), 'school', 'queried', fingerprint))
                added += cursor.rowcount
        return added

    def read(self):
        with self.connect() as db:
            db.row_factory = sqlite3.Row
            rows = db.execute('SELECT id,metric,value,providerAt,observedAt,source,state FROM observations ORDER BY id DESC LIMIT 5000').fetchall()
        return [{**dict(r), 'unit':'CNY', 'estimated':False} for r in reversed(rows)]
