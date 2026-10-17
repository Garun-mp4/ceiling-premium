"""Validated, idempotent delivery of website enquiries. No contact data is logged."""
import hashlib
import hmac
import json
import math
import os
import re
import socket
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID

RATES = json.loads((Path(__file__).resolve().parent.parent / 'data' / 'pricing.json').read_text(encoding='utf-8'))
MAX_BODY = 16 * 1024
CONSENT_VERSION = '2026-10-18'
MATERIALS = {'matte': 'Матовая', 'satin': 'Сатиновая', 'gloss': 'Глянцевая'}
PROFILES = {'standard': 'Стандартный', 'shadow': 'Теневой', 'floating': 'Парящий с подсветкой'}
FIELDS = {'area': 'Площадь, м²', 'perimeter': 'Периметр, м', 'lights': 'Точечные светильники, шт.', 'lines': 'Световые линии, м', 'tracks': 'Треки, м', 'curtain': 'Скрытый карниз, м', 'corners': 'Всего углов', 'pipes': 'Обходы труб'}
UTM_KEYS = {'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'}


class InvalidInput(ValueError):
    pass


class ServiceUnavailable(RuntimeError):
    pass


def text_field(value, maximum, code):
    if value is None:
        return ''
    if not isinstance(value, str) or len(value) > maximum:
        raise InvalidInput(code)
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', value).strip()


def normalize_phone(value):
    if not isinstance(value, str) or len(value) > 32 or not re.fullmatch(r'[+0-9()\s.\-]+', value):
        return None
    digits = re.sub(r'[^0-9]', '', value)
    if len(digits) == 10:
        digits = '7' + digits
    elif len(digits) == 11 and digits.startswith('8'):
        digits = '7' + digits[1:]
    return '+' + digits if re.fullmatch(r'7[0-9]{10}', digits) else None


def validate_calculator(raw):
    if not isinstance(raw, dict):
        raise InvalidInput('invalid_calculator')
    result = {}
    for key, bounds in RATES['bounds'].items():
        value = raw.get(key)
        if isinstance(value, str) and re.fullmatch(r'[0-9]+(?:[.,][0-9]+)?', value.strip()):
            value = float(value.strip().replace(',', '.'))
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise InvalidInput('invalid_calculator')
        if not bounds[0] <= value <= bounds[1] or (key in ('lights', 'corners', 'pipes') and value != int(value)):
            raise InvalidInput('invalid_calculator')
        result[key] = value
    for key in ('material', 'profile'):
        value = raw.get(key)
        if not isinstance(value, str) or value not in RATES['materials' if key == 'material' else 'profiles']:
            raise InvalidInput('invalid_calculator')
        result[key] = value
    return result


def calculate(value):
    def cents(number):
        return math.floor(number * 100 + 0.5) / 100
    parts = [cents(value['area'] * RATES['materials'][value['material']]), cents(value['perimeter'] * RATES['profiles'][value['profile']])]
    for key, rate in RATES['extras'].items():
        quantity = max(0, value[key] - 4) if key == 'corners' else value[key]
        parts.append(cents(quantity * rate))
    subtotal = sum(parts)
    total = max(RATES['minimum'], subtotal)
    return {'subtotal': subtotal, 'total': total,
            'low': max(RATES['minimum'], math.floor(total * RATES['lowMultiplier'] / 10 + 0.5) * 10),
            'high': math.floor(total * RATES['highMultiplier'] / 10 + 0.5) * 10}


def validate_payload(raw):
    if not isinstance(raw, dict):
        raise InvalidInput('invalid_json')
    if text_field(raw.get('website'), 200, 'invalid_request'):
        raise InvalidInput('invalid_request')
    phone = normalize_phone(text_field(raw.get('phone'), 32, 'phone_required'))
    if not phone:
        raise InvalidInput('phone_required')
    if raw.get('privacyConsent') is not True:
        raise InvalidInput('privacy_consent_required')
    if raw.get('consentVersion') != CONSENT_VERSION:
        raise InvalidInput('consent_version_outdated')
    request_id = raw.get('requestId')
    try:
        request_id = str(UUID(request_id)) if isinstance(request_id, str) else ''
    except ValueError:
        request_id = ''
    if not request_id:
        raise InvalidInput('invalid_request_id')
    source = text_field(raw.get('source'), 120, 'invalid_source')
    if not re.fullmatch(r'[a-zA-Z0-9:_-]{1,120}', source):
        raise InvalidInput('invalid_source')
    page = text_field(raw.get('page'), 250, 'invalid_page')
    if not page.startswith('/') or page.startswith('//') or any(c in page for c in ('?', '#', '\n', '\r')):
        raise InvalidInput('invalid_page')
    calculator = raw.get('calculator')
    if calculator is not None:
        calculator = validate_calculator(calculator)
    utm = raw.get('utm', {})
    if not isinstance(utm, dict):
        raise InvalidInput('invalid_utm')
    return {'phone': phone, 'name': text_field(raw.get('name'), 80, 'invalid_name'),
            'comment': text_field(raw.get('comment'), 1000, 'invalid_comment'),
            'requestId': request_id, 'source': source, 'page': page, 'calculator': calculator,
            'utm': {key: text_field(value, 100, 'invalid_utm') for key, value in utm.items() if key in UTM_KEYS},
            'privacyConsent': True, 'consentVersion': CONSENT_VERSION}


def redis_command(command):
    url = os.environ.get('UPSTASH_REDIS_REST_URL') or os.environ.get('KV_REST_API_URL')
    token = os.environ.get('UPSTASH_REDIS_REST_TOKEN') or os.environ.get('KV_REST_API_TOKEN')
    if not url or not token or urlparse(url).scheme != 'https':
        raise ServiceUnavailable('rate_limit_unavailable')
    request = urllib.request.Request(url, data=json.dumps(command).encode(), headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(request, timeout=4) as response:
            data = json.loads(response.read().decode())
        if not isinstance(data, dict) or 'error' in data or 'result' not in data:
            raise ServiceUnavailable('rate_limit_unavailable')
        return data['result']
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise ServiceUnavailable('rate_limit_unavailable') from exc


def digest(value):
    secret = os.environ.get('RATE_LIMIT_SALT', '')
    if len(secret) < 32:
        raise ServiceUnavailable('rate_limit_unavailable')
    return hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()


# Claim and throttle atomically across all function instances. Only opaque hashes,
# random request IDs and short-lived counters are written to Redis.
CLAIM_SCRIPT = """
local existing = redis.call('GET', KEYS[2])
if existing then
  if existing == 'done:' .. ARGV[1] then return 2 end
  if existing == 'pending:' .. ARGV[1] then return 3 end
  return 4
end
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], 60) end
if count > 5 then return 0 end
redis.call('SET', KEYS[2], 'pending:' .. ARGV[1], 'EX', 600)
return 1
"""


def claim_request(payload, source_ip):
    fingerprint = digest(json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(',', ':')))
    key = 'pole:request:' + payload['requestId']
    state = redis_command(['EVAL', CLAIM_SCRIPT, 2, 'pole:rate:' + digest(source_ip), key, fingerprint])
    return state, key, fingerprint


def origin_allowed(origin, host):
    if not origin:
        return True  # Non-browser callers still pass validation and the shared limit.
    try:
        parsed = urlparse(origin)
    except ValueError:
        return False
    allowed = {host.lower(), 'ceiling-premium.vercel.app'}
    for key in ('VERCEL_URL', 'VERCEL_BRANCH_URL'):
        if os.environ.get(key):
            allowed.add(os.environ[key].lower())
    return parsed.scheme in ('https', 'http') and parsed.netloc.lower() in allowed and parsed.path in ('', '/')


def build_telegram_message(payload):
    lines = ['Новое обращение · ПОЛЕ', 'Номер: ' + payload['requestId'], 'Телефон: ' + payload['phone']]
    if payload['name']:
        lines.append('Имя: ' + payload['name'])
    if payload['comment']:
        lines.extend(['', 'Комментарий: ' + payload['comment']])
    if payload['calculator']:
        value = payload['calculator']
        price = calculate(value)
        lines.extend(['', 'Комплектация:', 'Фактура: ' + MATERIALS[value['material']], 'Профиль: ' + PROFILES[value['profile']]])
        lines.extend(f'{label}: {value[key]:g}' for key, label in FIELDS.items())
        lines.append(f"Расчёт сервера: {price['low']:,}–{price['high']:,} ₽".replace(',', ' '))
        lines.append('Светильники, сложная электрика и нестандартные работы отдельно.')
    lines.extend(['', 'Источник: ' + payload['source'], 'Страница: ' + payload['page']])
    lines.extend(f'{key}: {value}' for key, value in payload['utm'].items())
    lines.extend(['Согласие: ' + CONSENT_VERSION, 'Получено: ' + datetime.now(timezone.utc).isoformat(timespec='seconds')])
    return '\n'.join(lines)[:3800]


def send_to_telegram(token, chat_id, message):
    request = urllib.request.Request('https://api.telegram.org/bot' + token + '/sendMessage',
        data=json.dumps({'chat_id': chat_id, 'text': message, 'disable_web_page_preview': True}, ensure_ascii=False).encode('utf-8'),
        headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(request, timeout=8) as response:
        result = json.loads(response.read().decode('utf-8'))
    if not isinstance(result, dict) or result.get('ok') is not True:
        raise ServiceUnavailable('telegram_send_failed')


def process_submission(raw, origin, host, source_ip):
    if not origin_allowed(origin, host):
        return 403, {'ok': False, 'error': 'origin_not_allowed'}
    try:
        payload = validate_payload(raw)
    except InvalidInput as exc:
        return 400, {'ok': False, 'error': str(exc)}
    token, chat_id = os.environ.get('TELEGRAM_BOT_TOKEN'), os.environ.get('TELEGRAM_CHAT_ID')
    if not token or not chat_id:
        return 503, {'ok': False, 'error': 'delivery_unavailable'}
    try:
        state, key, fingerprint = claim_request(payload, source_ip)
    except ServiceUnavailable:
        return 503, {'ok': False, 'error': 'delivery_unavailable'}
    if state == 0:
        return 429, {'ok': False, 'error': 'rate_limited'}
    if state == 2:
        return 200, {'ok': True, 'requestId': payload['requestId']}
    if state in (3, 4):
        return 409, {'ok': False, 'error': 'delivery_pending' if state == 3 else 'request_conflict'}
    if state != 1:
        return 503, {'ok': False, 'error': 'delivery_unavailable'}
    try:
        send_to_telegram(token, chat_id, build_telegram_message(payload))
    except (urllib.error.HTTPError, ServiceUnavailable):
        try:
            redis_command(['DEL', key])
        except ServiceUnavailable:
            pass  # Expiry permits a later retry even if Redis is temporarily down.
        return 502, {'ok': False, 'error': 'telegram_send_failed'}
    except (urllib.error.URLError, TimeoutError, socket.timeout, json.JSONDecodeError):
        # Telegram may have received the request. Keep the claim; do not resend.
        return 502, {'ok': False, 'error': 'delivery_pending'}
    try:
        redis_command(['SET', key, 'done:' + fingerprint, 'EX', 600])
    except ServiceUnavailable:
        pass  # Delivery is confirmed even if recording its receipt failed.
    return 200, {'ok': True, 'requestId': payload['requestId']}


class handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Never log URLs or submitted contact information.

    def do_POST(self):
        if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
            self._send_json({'ok': False, 'error': 'unsupported_media_type'}, 415)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            length = 0
        if length > MAX_BODY:
            self._send_json({'ok': False, 'error': 'body_too_large'}, 413)
            return
        if length <= 0:
            self._send_json({'ok': False, 'error': 'invalid_json'}, 400)
            return
        try:
            payload = json.loads(self.rfile.read(length).decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json({'ok': False, 'error': 'invalid_json'}, 400)
            return
        # Vercel overwrites x-forwarded-for at the trusted platform boundary.
        source_ip = self.headers.get('x-forwarded-for', self.client_address[0]).split(',')[0].strip()
        status, data = process_submission(payload, self.headers.get('Origin'), self.headers.get('Host', ''), source_ip)
        self._send_json(data, status, {'Retry-After': '60'} if status == 429 else None)

    def _send_json(self, data, status=200, extra_headers=None):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def _method_not_allowed(self):
        self._send_json({'ok': False, 'error': 'method_not_allowed'}, 405, {'Allow': 'POST'})

    do_GET = do_HEAD = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = _method_not_allowed
