import importlib.util
from pathlib import Path
import sqlite3
import unittest
import tempfile

spec=importlib.util.spec_from_file_location('collector',Path(__file__).resolve().parents[1]/'collector'/'ranking_collector.py')
collector=importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)
ID='wrld_00000000-0000-4000-8000-000000000001'

class CollectorTests(unittest.TestCase):
    def test_author_only_and_chinese_are_not_japanese(self):
        self.assertFalse(collector.japanese({'name':'Home','author':'日本の作者'}))
        self.assertFalse(collector.japanese({'name':'世界都市'}))
        self.assertTrue(collector.japanese({'name':'夜のカフェ'}))
        self.assertTrue(collector.japanese({'name':'Hangout','tags':['author_tag_jp']}))
        self.assertTrue(collector.japanese({'name':'[JP] Lounge'}))

    def test_manual_exclusion_wins(self):
        self.assertFalse(collector.japanese({'id':ID,'name':'日本語'}, {'include':[ID],'exclude':[ID]}))
        self.assertTrue(collector.japanese({'id':ID,'name':'Home'}, {'include':[ID]}))

    def test_missing_counts_not_zero(self):
        self.assertFalse(collector.valid_counts({'occupants':0}))
        self.assertFalse(collector.valid_counts({'occupants':True,'publicOccupants':0,'privateOccupants':0}))
        self.assertTrue(collector.valid_counts({'occupants':0,'publicOccupants':0,'privateOccupants':0}))

    def test_history_gaps_and_same_hour_replacement(self):
        db=sqlite3.connect(':memory:');db.executescript(collector.SCHEMA)
        hour=1791766800
        w={'id':ID,'name':'日本語','author':'a','platforms':['pc'],'thumbnail':None,'total':10,'public':3,'private':7,'observedAt':collector.iso(hour)}
        collector.persist(db,hour,[w],500,1,0,collector.iso(hour))
        collector.persist(db,hour+7200,[dict(w,total=20,observedAt=collector.iso(hour+7200))],500,1,0,collector.iso(hour+7200))
        snapshot=collector.build_snapshot(db,hour+7200)
        self.assertIsNone(snapshot['worlds'][0]['deltaTotal'])
        self.assertEqual(len(snapshot['worlds'][0]['history']),2)
        collector.persist(db,hour+7200,[],500,0,0,collector.iso(hour+7200))
        self.assertEqual(collector.build_snapshot(db,hour+7200)['worlds'],[])

    def test_pagination_deduplicates_worlds(self):
        class FakeApi:
            def get(self,path):
                return [{'id':ID}]*100
        self.assertEqual(len(collector.candidates(FakeApi(),500)),1)

    def test_existing_db_is_read_only(self):
        runtime=Path(__file__).resolve().parents[1]/'.runtime'
        runtime.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as directory:
            self.assertTrue(Path(directory).resolve().is_relative_to(runtime.resolve()))
            path=Path(directory)/'source.sqlite'
            db=sqlite3.connect(path)
            try:
                db.execute('CREATE TABLE worlds(id TEXT PRIMARY KEY,record TEXT)')
                db.commit()
            finally:db.close()
            source=collector.open_source(path)
            try:
                with self.assertRaises(sqlite3.OperationalError):
                    source.execute('INSERT INTO worlds VALUES(?,?)',(ID,'{}'))
            finally:source.close()

    def test_failed_population_is_excluded_not_zero(self):
        source=sqlite3.connect(':memory:')
        source.execute('CREATE TABLE worlds(id TEXT PRIMARY KEY,record TEXT)')
        class FakeApi:
            def get(self,path):
                return {'id':ID,'name':'日本語の部屋','releaseStatus':'public','occupants':10}
        worlds,eligible,failed=collector.observe(FakeApi(),source,{},[{'id':ID}])
        self.assertEqual(worlds,[])
        self.assertEqual((eligible,failed),(1,1))

    def test_exhausted_rate_limit_aborts_without_continuing_requests(self):
        source=sqlite3.connect(':memory:');source.execute('CREATE TABLE worlds(id TEXT PRIMARY KEY,record TEXT)')
        class FakeApi:
            calls=0
            def get(self,path):
                self.calls+=1
                raise collector.ServiceUnavailable('limited')
        api=FakeApi()
        with self.assertRaises(collector.ServiceUnavailable):
            collector.observe(api,source,{},[{'id':ID},{'id':ID}])
        self.assertEqual(api.calls,1)

    def test_foreign_candidate_cache_skips_repeat_detail_fetch(self):
        source=sqlite3.connect(':memory:');source.execute('CREATE TABLE worlds(id TEXT PRIMARY KEY,record TEXT)')
        cache=sqlite3.connect(':memory:');cache.executescript(collector.SCHEMA)
        class FakeApi:
            calls=0
            def get(self,path):
                self.calls+=1
                return {'id':ID,'name':'English Lounge','description':'Welcome','releaseStatus':'public'}
        api=FakeApi()
        collector.observe(api,source,{},[{'id':ID,'name':'English Lounge'}],cache=cache)
        collector.observe(api,source,{},[{'id':ID,'name':'English Lounge'}],cache=cache)
        self.assertEqual(api.calls,1)

if __name__=='__main__':unittest.main()
