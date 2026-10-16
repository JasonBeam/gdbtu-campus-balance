import tempfile
from pathlib import Path
import unittest

from campus import demo_snapshot
from journal import Journal


class JournalTests(unittest.TestCase):
    def test_no_demo_no_missing_time_no_duplicates_no_stale_rows(self):
        with tempfile.TemporaryDirectory() as folder:
            journal = Journal(Path(folder)/'campus.sqlite3')
            self.assertEqual(journal.record(demo_snapshot()),0)
            snapshot={'demo':False,'metrics':{
                'power':{'value':0,'state':'queried','providerAt':'2026-10-16T12:00:00+08:00','fetchedAt':'2026-10-16T12:01:00+08:00'},
                'card':{'value':22,'state':'queried','providerAt':None}}}
            self.assertEqual(journal.record(snapshot),1)
            self.assertEqual(journal.record(snapshot),0)
            snapshot['metrics']['power']['state']='stale'
            snapshot['metrics']['power']['value']=5
            self.assertEqual(journal.record(snapshot),0)
            rows=journal.read();self.assertEqual(len(rows),1)
            self.assertEqual(rows[0]['value'],0)
            self.assertEqual(rows[0]['providerAt'],'2026-10-16T12:00:00+08:00')
            self.assertEqual(rows[0]['observedAt'],'2026-10-16T12:01:00+08:00')


if __name__=='__main__':unittest.main()
