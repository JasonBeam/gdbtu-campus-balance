import json
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import campus
import server

CFG = {'syscustid':'test-user','acc_token':'test-token','buildingID':'test-room','custid':'test-card'}


class CampusTests(unittest.TestCase):
    def test_amount_missing_is_not_zero(self):
        for value in [None, '', ' ', True, False, {}, [], 'abc', 'NaN', 'Infinity', float('inf')]:
            with self.subTest(value=value), self.assertRaises(campus.QueryError):
                campus.amount(value)
        self.assertEqual(campus.amount('0'), 0)
        self.assertEqual(campus.amount('-3.20'), -3.2)

    def test_response_formats(self):
        self.assertEqual(campus.data_of({'code':0,'data':'[{"leftMoney":"12.30"}]'}), [{'leftMoney':'12.30'}])
        for value in [None, {'code':False}, {'code':'0'}, {'code':401,'msg':'test-token'}]:
            with self.assertRaises(campus.QueryError):
                campus.data_of(value)

    def test_card_survives_power_failure_and_failed_login(self):
        def transport(path, body, cfg, referer):
            if path in (campus.ELECTRIC,campus.LOGIN):
                raise campus.QueryError('失败')
            self.assertEqual(path,campus.CARD)
            self.assertEqual(body['custid'],'test-card')
            return {'code':0,'data':'0.00'}
        store=campus.Store(campus.Client(CFG,transport))
        result=store.snapshot()['metrics']
        self.assertEqual(result['power']['state'],'unavailable')
        self.assertEqual(result['card']['value'],0)
        self.assertIsNone(result['card']['providerAt'])
        self.assertNotIn('test-token',json.dumps(result))

    def test_auto_customer_and_session_id(self):
        def transport(path,body,cfg,referer):
            if path==campus.LOGIN:return {'code':0,'data':{'syscustid':'resolved'}}
            if path==campus.CUSTOMER:return {'code':0,'data':[{'custid':'resolved-card'}]}
            self.assertEqual(body['syscustid'],'resolved')
            self.assertEqual(body['custid'],'resolved-card')
            return {'code':0,'data':{'balance':'22.80','updatedAt':'2026-10-16 12:00:00'}}
        client=campus.Client({**CFG,'custid':''},transport)
        self.assertEqual(client.card()['value'],22.8)
        self.assertIn('+08:00',client.card()['providerAt'])

    def test_ambiguous_meters_are_rejected(self):
        client=campus.Client(CFG,lambda *a:{'code':0,'data':[{'leftMoney':1},{'leftMoney':2}]})
        with self.assertRaises(campus.QueryError):client.power()

    def test_cache_lock_and_failure_preserves_each_timestamp(self):
        class Fake:
            calls=0
            fail=False
            def power(self):
                self.calls+=1
                if self.fail:raise campus.QueryError('请更新凭据')
                return {'value':1,'providerAt':'2026-10-16T10:00:00+08:00'}
            def card(self):
                if self.fail:raise ValueError('sensitive upstream text')
                return {'value':2,'providerAt':None}
        fake=Fake();store=campus.Store(fake)
        before=store.snapshot()['metrics']['power'].copy()
        store.snapshot();self.assertEqual(fake.calls,1)
        fake.fail=True;store.last=float('-inf')
        after=store.snapshot()['metrics']
        self.assertEqual(after['power']['value'],1)
        self.assertEqual(after['power']['fetchedAt'],before['fetchedAt'])
        self.assertEqual(after['power']['state'],'stale')
        self.assertNotIn('sensitive',json.dumps(after))

    def test_timestamp_does_not_invent_school_time(self):
        self.assertIsNone(campus.provider_time(None))
        self.assertIsNone(campus.provider_time('invalid'))
        self.assertEqual(campus.provider_time('2026-10-16 12:00:00'),'2026-10-16T12:00:00+08:00')

    def test_http_allowlist_and_origin_checks(self):
        http=server.ThreadingHTTPServer(('127.0.0.1',0),server.handler(demo=True))
        port=http.server_address[1];http.allowed_hosts={f'127.0.0.1:{port}'}
        worker=threading.Thread(target=http.serve_forever,daemon=True);worker.start()
        try:
            base=f'http://127.0.0.1:{port}'
            with urlopen(base+'/api/snapshot') as result:
                data=json.load(result);self.assertTrue(data['demo'])
                self.assertEqual(result.headers['Cache-Control'],'no-store')
                self.assertNotIn('acc_token',json.dumps(data))
            for path in ['/config.local.json','/config.example.json','/campus.py','/../campus.py']:
                with self.subTest(path=path), self.assertRaises(HTTPError) as error:urlopen(base+path)
                self.assertEqual(error.exception.code,404)
            for headers in [{'Host':'attacker.invalid'},{'Sec-Fetch-Site':'cross-site'}]:
                with self.assertRaises(HTTPError) as error:urlopen(Request(base+'/api/snapshot',headers=headers))
                self.assertEqual(error.exception.code,403)
        finally:
            http.shutdown();http.server_close();worker.join()


if __name__=='__main__':unittest.main()
