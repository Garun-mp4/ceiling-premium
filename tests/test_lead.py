import copy
import io
import json
import os
import threading
import unittest
import urllib.error
import urllib.request
from http.server import HTTPServer
from pathlib import Path
from unittest.mock import patch

from api import lead

BASE = {'phone': '+7 (996) 420-65-69', 'name': '', 'comment': '', 'privacyConsent': True,
        'consentVersion': lead.CONSENT_VERSION, 'source': 'test', 'page': '/stoimost/',
        'requestId': '20d8702e-c369-41d7-81c4-8d25db2628c5', 'calculator': None, 'utm': {}, 'website': ''}


class ValidationTests(unittest.TestCase):
    def test_shared_calculations(self):
        cases = json.loads((Path(__file__).parent / 'calculation-cases.json').read_text(encoding='utf-8'))
        for case in cases:
            with self.subTest(case=case['name']):
                result = lead.calculate(lead.validate_calculator(case['input']))
                self.assertEqual(result, case['expected'])

    def test_invalid_calculator(self):
        for key, value in [('area', 1.99), ('area', 201), ('area', ''), ('area', '0x10'), ('area', '1e2'), ('area', True), ('area', float('inf')), ('perimeter', -1), ('lights', 1.5), ('corners', 3), ('pipes', 0.5), ('material', {}), ('profile', '__proto__')]:
            with self.subTest(key=key, value=value), self.assertRaises(lead.InvalidInput):
                lead.validate_calculator({**lead.RATES['defaults'], key: value})

    def test_phone_parity(self):
        for value in ['+7 (996) 420-65-69', '8 996 420 65 69', '9964206569']:
            self.assertEqual(lead.normalize_phone(value), '+79964206569')
        for value in ['', '+12345678901', '7996', '899642065699', 'abc79964206569', None]:
            self.assertIsNone(lead.normalize_phone(value))

    def test_untrusted_fields_and_consent(self):
        for key, value in [('name', {}), ('name', 'a'*81), ('comment', 'a'*1001), ('phone', []), ('privacyConsent', 1), ('consentVersion', 'old'), ('page', 'https://bad.test/'), ('requestId', '../bad'), ('website', 'spam'), ('utm', [])]:
            with self.subTest(key=key), self.assertRaises(lead.InvalidInput):
                lead.validate_payload({**BASE, key: value})
        cleaned = lead.validate_payload({**BASE, 'estimate': 1, 'secret': 'untrusted', 'utm': {'utm_source':'search', 'phone':'private'}})
        self.assertNotIn('estimate', cleaned)
        self.assertNotIn('secret', cleaned)
        self.assertEqual(cleaned['utm'], {'utm_source': 'search'})

    def test_message_recalculates_and_omits_untrusted_price(self):
        payload = lead.validate_payload({**BASE, 'calculator': lead.RATES['defaults'], 'estimate': 1})
        text = lead.build_telegram_message(payload)
        self.assertIn('11 950–13 840 ₽', text)
        self.assertIn('Согласие: '+lead.CONSENT_VERSION, text)
        self.assertLessEqual(len(text), 3800)


@patch.dict(os.environ, {'TELEGRAM_BOT_TOKEN': 'test', 'TELEGRAM_CHAT_ID':'test', 'RATE_LIMIT_SALT':'x'*32})
class DeliveryTests(unittest.TestCase):
    def call(self, payload=None, origin='https://ceiling-premium.vercel.app'):
        return lead.process_submission(payload or copy.deepcopy(BASE), origin, 'ceiling-premium.vercel.app', '127.0.0.1')

    def test_origin_rejected_before_any_delivery(self):
        with patch.object(lead, 'claim_request') as claim:
            self.assertEqual(self.call(origin='https://evil.example')[0], 403)
            self.assertEqual(self.call(origin='https://[')[0], 403)
            claim.assert_not_called()

    def test_success_and_confirmed_duplicate(self):
        with patch.object(lead, 'claim_request', return_value=(1, 'opaque-key', 'hash')), patch.object(lead, 'send_to_telegram') as send, patch.object(lead, 'redis_command') as redis:
            self.assertEqual(self.call()[1]['ok'], True)
            send.assert_called_once()
            redis.assert_called_once_with(['SET', 'opaque-key', 'done:hash', 'EX', 600])
        with patch.object(lead, 'claim_request', return_value=(2, 'key', 'hash')), patch.object(lead, 'send_to_telegram') as send:
            self.assertEqual(self.call()[0], 200)
            send.assert_not_called()

    def test_limit_and_pending_do_not_send(self):
        for state, status in [(0,429),(3,409),(4,409)]:
            with patch.object(lead, 'claim_request', return_value=(state,'key','hash')), patch.object(lead, 'send_to_telegram') as send:
                self.assertEqual(self.call()[0], status)
                send.assert_not_called()

    def test_uncertain_delivery_keeps_claim_without_retry(self):
        with patch.object(lead, 'claim_request', return_value=(1,'key','hash')), patch.object(lead, 'send_to_telegram', side_effect=TimeoutError), patch.object(lead, 'redis_command') as redis:
            self.assertEqual(self.call()[1]['error'], 'delivery_pending')
            redis.assert_not_called()

    def test_explicit_telegram_rejection_allows_later_retry(self):
        with patch.object(lead, 'claim_request', return_value=(1,'key','hash')), patch.object(lead, 'send_to_telegram', side_effect=lead.ServiceUnavailable), patch.object(lead, 'redis_command') as redis:
            self.assertEqual(self.call()[1]['error'], 'telegram_send_failed')
            redis.assert_called_once_with(['DEL', 'key'])

    def test_store_failure_fails_closed(self):
        with patch.object(lead, 'claim_request', side_effect=lead.ServiceUnavailable), patch.object(lead, 'send_to_telegram') as send:
            self.assertEqual(self.call()[0], 503)
            send.assert_not_called()

    def test_redis_contains_hashes_not_contacts(self):
        with patch.object(lead, 'redis_command', return_value=1) as redis:
            lead.claim_request(lead.validate_payload(BASE), '127.0.0.1')
            command = json.dumps(redis.call_args.args[0])
            self.assertNotIn('996', command)
            self.assertNotIn('127.0.0.1', command)


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(('127.0.0.1', 0), lead.handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}/api/lead'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, body, content_type='application/json', method='POST'):
        try:
            response = urllib.request.urlopen(urllib.request.Request(self.url, data=body, headers={'Content-Type':content_type}, method=method))
        except urllib.error.HTTPError as error:
            response = error
        return response.code, response.read()

    def test_body_limits_and_types(self):
        self.assertEqual(self.request(b'x'*16385)[0], 413)
        self.assertEqual(self.request(b'{')[0], 400)
        self.assertEqual(self.request(b'{}', 'text/plain')[0], 415)
        self.assertEqual(self.request(b'{}', method='PUT')[0], 405)
        self.assertEqual(self.request(b'{}', method='HEAD'), (405,b''))

    def test_consent_validation_before_services(self):
        body = json.dumps({**BASE, 'privacyConsent':False}).encode()
        status, body = self.request(body)
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(body)['error'], 'privacy_consent_required')


if __name__ == '__main__':
    unittest.main()
