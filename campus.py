"""GDBTU read-only balance client. Python 3.10+, standard library only."""
from __future__ import annotations

import datetime as dt
import json
import math
import threading
import time
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPRedirectHandler

BASE = 'https://ecykt.gdbtu.edu.cn'
ELECTRIC = '/ykt-mini/api/electricnew/service'
CARD = '/ykt-mini/scanpay/getUserBalance'
CUSTOMER = '/ykt-mini/api/customer/getSysBindCustInfo'
LOGIN = '/ykt-mini/api/customer/loginBySysId'
APPID = 'wx7077a0b57d156efe'
VERSION = 'v1.1.55'
TZ = dt.timezone(dt.timedelta(hours=8))
TTL = 1200
MAX_BYTES = 65536


def now():
    return dt.datetime.now(TZ).isoformat(timespec='seconds')


class QueryError(Exception):
    """Only fixed, non-sensitive messages may enter this exception."""


def amount(value):
    if isinstance(value, bool) or value is None or not isinstance(value, (int, float, str)):
        raise QueryError('接口未返回有效余额')
    if isinstance(value, str) and not value.strip():
        raise QueryError('接口未返回有效余额')
    try:
        parsed = float(value)
    except (ValueError, TypeError, OverflowError):
        raise QueryError('接口未返回有效余额') from None
    if not math.isfinite(parsed) or abs(parsed) > 1e9:
        raise QueryError('接口未返回有效余额')
    return parsed


def data_of(result):
    if not isinstance(result, dict) or type(result.get('code')) is not int or result['code'] != 0:
        raise QueryError('学校接口拒绝请求，请核对参数或更新登录凭据')
    data = result.get('data')
    if isinstance(data, str):
        try:
            return json.loads(data)
        except (ValueError, TypeError):
            return data
    return data


def provider_time(value):
    if not isinstance(value, str) or len(value) > 40:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        if not parsed.tzinfo:
            parsed = parsed.replace(tzinfo=TZ)
        return parsed.isoformat(timespec='seconds')
    except ValueError:
        return None


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward acc_token to a redirect target.


def post(path, body, cfg, referer):
    headers = {'Accept': 'application/json', 'Content-Type': 'application/json',
               'Origin': BASE, 'Referer': referer, 'acc_token': cfg['acc_token'],
               'User-Agent': cfg.get('userAgent') or 'Mozilla/5.0'}
    try:
        request = Request(BASE + path, data=json.dumps(body).encode(), headers=headers, method='POST')
        with build_opener(NoRedirect).open(request, timeout=10) as response:
            raw = response.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise QueryError('学校响应过大')
            return json.loads(raw)
    except HTTPError as error:
        if error.code in (401, 403):
            raise QueryError('登录凭据已失效，请重新提取 acc_token') from None
        raise QueryError('学校接口暂时不可用') from None
    except QueryError:
        raise
    except Exception:
        raise QueryError('学校接口连接或解析失败') from None


class Client:
    def __init__(self, cfg, transport=post):
        self.cfg = {key: str(cfg.get(key) or '').strip() for key in
                    ('syscustid', 'acc_token', 'buildingID', 'custid', 'userAgent', 'areacode', 'timestamp')}
        self.cfg['areacode'] = self.cfg['areacode'] or '450010'
        self.transport = transport

    def call(self, path, payload, power=False):
        cfg = self.cfg
        if not cfg['syscustid'] or not cfg['acc_token']:
            raise QueryError('请先配置 syscustid 和 acc_token')
        referer = (BASE + '/ykt-view/powernew?interfaceName=powernew_' + cfg['areacode'] + '&isbind=1'
                   if power else BASE + '/ykt-view/recharge?isbind=1')
        body = {'syscustid': cfg['syscustid'], 'acc_token': cfg['acc_token'], **payload}
        if cfg.get('timestamp'):
            body['timestamp'] = cfg['timestamp']
        return data_of(self.transport(path, body, cfg, referer))

    def power(self):
        if not self.cfg['buildingID']:
            raise QueryError('请配置宿舍 buildingID')
        data = self.call(ELECTRIC, {'server': '/api/getMeterStatus',
                         'areacode': self.cfg['areacode'], 'buildingID': self.cfg['buildingID']}, True)
        if isinstance(data, list):
            # Never select another room silently if an account has multiple meters.
            if len(data) != 1:
                raise QueryError('电表数量不是一，请在官方页面核对宿舍绑定')
            data = data[0]
        if not isinstance(data, dict):
            raise QueryError('电表数据格式变化')
        try:
            remaining = amount(data.get('remaining'))
        except QueryError:
            remaining = None
        return {'value': amount(data.get('leftMoney')), 'remaining': remaining,
                'providerAt': provider_time(data.get('updateDateTime'))}

    def card(self):
        # Existing Scriptable performs loginBySysId; ESP firmware omits it.
        # Keep it best-effort: a valid captured custid can still query independently.
        balance_id = self.cfg['syscustid']
        try:
            session = self.call(LOGIN, {'areacode': self.cfg['areacode'], 'version': VERSION,
                                      'appid': APPID, 'redirect': '/recharge?isbind=1'})
            if isinstance(session, dict) and session.get('syscustid'):
                balance_id = str(session['syscustid'])
        except QueryError:
            pass
        custid = self.cfg['custid']
        if not custid:
            data = self.call(CUSTOMER, {'appid': APPID, 'areacode': self.cfg['areacode'], 'version': VERSION})
            if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
                raise QueryError('请从自己的校园卡请求提取 custid 后配置')
            custid = str(data[0].get('custid') or '')
        if not custid:
            raise QueryError('未返回校园卡 custid')
        data = self.call(CARD, {'syscustid': balance_id, 'custid': custid})
        return {'value': amount(data.get('balance') if isinstance(data, dict) else data),
                'providerAt': provider_time(data.get('updatedAt') or data.get('updateDateTime'))
                if isinstance(data, dict) else None}


class Store:
    """One lock, bounded polling, independent last-good values; memory only."""
    def __init__(self, client):
        self.client = client
        self.lock = threading.Lock()
        self.last = float('-inf')
        self.metrics = {}

    def snapshot(self):
        with self.lock:
            if time.monotonic() - self.last >= TTL:
                for key in ('power', 'card'):
                    previous = self.metrics.get(key, {})
                    try:
                        metric = getattr(self.client, key)()
                        self.metrics[key] = {**metric, 'state': 'queried', 'fetchedAt': now(), 'error': None}
                    except Exception as error:
                        self.metrics[key] = {**previous, 'value': previous.get('value'),
                            'providerAt': previous.get('providerAt'), 'fetchedAt': previous.get('fetchedAt'),
                            'state': 'stale' if previous.get('value') is not None else 'unavailable',
                            'error': str(error) if isinstance(error, QueryError) else '查询失败'}
                self.last = time.monotonic()
            return {'school': '广东工商职业技术大学', 'demo': False, 'metrics': self.metrics}


def demo_snapshot():
    return {'school': '广东工商职业技术大学', 'demo': True, 'metrics': {
        'power': {'value': 86.42, 'state': 'demo', 'providerAt': None, 'fetchedAt': None, 'error': None},
        'card': {'value': 32.80, 'state': 'demo', 'providerAt': None, 'fetchedAt': None, 'error': None}}}
