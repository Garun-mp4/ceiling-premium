import json
import os
import re
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler


MAX_FIELD_LENGTH = 500
MAX_MESSAGE_LENGTH = 3800


FIELD_LABELS = {
    "source": "Источник",
    "name": "Имя",
    "phone": "Телефон",
    "message": "Сообщение",
    "comment": "Комментарий",
    "estimate": "Ориентир",
    "page": "Страница",
    "privacyConsent": "Согласие на обработку персональных данных",
}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self._send_json(
            {"ok": False, "error": "method_not_allowed"},
            status=405,
            extra_headers={"Allow": "POST"},
        )

    def do_HEAD(self):
        self._send_json(
            {"ok": False, "error": "method_not_allowed"},
            status=405,
            extra_headers={"Allow": "POST"},
        )

    def do_PUT(self):
        self._send_json(
            {"ok": False, "error": "method_not_allowed"},
            status=405,
            extra_headers={"Allow": "POST"},
        )

    def do_PATCH(self):
        self._send_json(
            {"ok": False, "error": "method_not_allowed"},
            status=405,
            extra_headers={"Allow": "POST"},
        )

    def do_DELETE(self):
        self._send_json(
            {"ok": False, "error": "method_not_allowed"},
            status=405,
            extra_headers={"Allow": "POST"},
        )

    def do_OPTIONS(self):
        self._send_json(
            {"ok": False, "error": "method_not_allowed"},
            status=405,
            extra_headers={"Allow": "POST"},
        )

    def do_POST(self):
        token = os.environ.get("TELEGRAM_BOT_TOKEN1")
        chat_id = os.environ.get("TELEGRAM_CHAT_ID1")

        if not token or not chat_id:
            self._send_json({"ok": False, "error": "telegram_env_missing"}, status=500)
            return

        try:
            payload = self._read_json()
        except ValueError:
            self._send_json({"ok": False, "error": "invalid_json"}, status=400)
            return

        name = clean_value(payload.get("name"))
        phone = clean_value(payload.get("phone"))
        privacy_consent = payload.get("privacyConsent")

        if len(name) < 2:
            self._send_json({"ok": False, "error": "name_required"}, status=400)
            return

        if not is_valid_phone(phone):
            self._send_json({"ok": False, "error": "phone_required"}, status=400)
            return

        if privacy_consent is not True:
            self._send_json({"ok": False, "error": "privacy_consent_required"}, status=400)
            return

        message = build_telegram_message(payload)

        try:
            send_to_telegram(token, chat_id, message)
        except Exception:
            self._send_json({"ok": False, "error": "telegram_send_failed"}, status=502)
            return

        self._send_json({"ok": True})

    def _read_json(self):
        try:
            content_length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError as exc:
            raise ValueError("invalid_json") from exc

        if content_length <= 0:
            raise ValueError("empty_body")

        raw_body = self.rfile.read(content_length)
        try:
            data = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("invalid_json") from exc

        if not isinstance(data, dict):
            raise ValueError("invalid_json")

        return data

    def _send_json(self, data, status=200, extra_headers=None):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")

        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)


def clean_value(value, max_length=MAX_FIELD_LENGTH):
    if value is None:
        return ""

    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False)

    text = str(value)
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()[:max_length]


def is_valid_phone(phone):
    digits = re.sub(r"\D", "", phone)

    if len(digits) == 10:
        digits = f"7{digits}"

    if len(digits) == 11 and digits.startswith("8"):
        digits = f"7{digits[1:]}"

    return len(digits) == 11 and digits.startswith("7")


def label_for(key):
    return FIELD_LABELS.get(key, key[:1].upper() + key[1:])


def add_field(lines, label, value):
    text = clean_value(value)
    if text:
        lines.append(f"{label}: {text}")


def add_nested_fields(lines, data, prefix=""):
    if not isinstance(data, dict):
        return

    for key, value in data.items():
        if key in {"privacyConsent"}:
            continue

        label = label_for(key)
        full_label = f"{prefix} / {label}" if prefix else label

        if isinstance(value, dict):
            add_nested_fields(lines, value, full_label)
        elif isinstance(value, list):
            add_field(
                lines,
                full_label,
                ", ".join(clean_value(item) for item in value if clean_value(item)),
            )
        else:
            add_field(lines, full_label, value)


def build_telegram_message(payload):
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    lines = ["Новая заявка с сайта Потолок.Премиум", ""]
    add_field(lines, "Имя", payload.get("name"))
    add_field(lines, "Телефон", payload.get("phone"))
    add_field(lines, "Комментарий", payload.get("comment"))
    add_field(lines, "Ориентир", payload.get("estimate"))
    add_field(lines, "Источник", payload.get("source"))

    used_keys = {"name", "phone", "comment", "estimate", "source", "page", "privacyConsent"}
    extra = {key: value for key, value in payload.items() if key not in used_keys}
    if extra:
        lines.extend(["", "Дополнительно:"])
        add_nested_fields(lines, extra)

    lines.extend(
        [
            "",
            f"Страница: {clean_value(payload.get('page')) or 'не указана'}",
            f"Дата/время: {now}",
        ]
    )

    message = "\n".join(lines).strip()
    if len(message) > MAX_MESSAGE_LENGTH:
        message = f"{message[:MAX_MESSAGE_LENGTH - 20].rstrip()}\n\n[обрезано]"
    return message


def send_to_telegram(token, chat_id, message):
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    body = json.dumps(
        {
            "chat_id": chat_id,
            "text": message,
            "disable_web_page_preview": True,
        },
        ensure_ascii=False,
    ).encode("utf-8")

    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError("telegram_http_error")
        data = json.loads(response.read().decode("utf-8"))
        if not data.get("ok"):
            raise RuntimeError("telegram_api_error")
