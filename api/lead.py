from __future__ import annotations

import html
import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler


MAX_BODY_SIZE = 16 * 1024


def normalize_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone)

    if len(digits) == 10:
        return f"7{digits}"

    if len(digits) == 11 and digits.startswith("8"):
        return f"7{digits[1:]}"

    return digits


def format_phone(digits: str) -> str:
    if len(digits) != 11:
        return digits

    return f"+{digits[0]} ({digits[1:4]}) {digits[4:7]}-{digits[7:9]}-{digits[9:11]}"


def clean_text(value: object, limit: int = 500) -> str:
    if not isinstance(value, str):
        return ""

    return value.strip()[:limit]


def build_message(payload: dict[str, object]) -> tuple[str | None, str | None]:
    name = clean_text(payload.get("name"), 80)
    phone_digits = normalize_phone(clean_text(payload.get("phone"), 40))
    comment = clean_text(payload.get("comment"), 1000)
    estimate = clean_text(payload.get("estimate"), 120) or "не указан"
    consent = payload.get("consent")

    if len(name) < 2:
        return None, "Введите имя, минимум 2 символа."

    if len(phone_digits) != 11 or not phone_digits.startswith("7"):
        return None, "Проверьте номер телефона: нужен российский номер из 11 цифр."

    if consent is not True:
        return None, "Подтвердите согласие на обработку персональных данных."

    lines = [
        "<b>Новая заявка с сайта Потолок.Премиум</b>",
        f"<b>Имя:</b> {html.escape(name)}",
        f"<b>Телефон:</b> {html.escape(format_phone(phone_digits))}",
        f"<b>Ориентир:</b> {html.escape(estimate)}",
        f"<b>Комментарий:</b> {html.escape(comment) if comment else 'не указан'}",
        f"<b>Время:</b> {html.escape(datetime.now().strftime('%d.%m.%Y %H:%M:%S'))}",
    ]

    return "\n".join(lines), None


def send_to_telegram(message: str) -> tuple[bool, str | None]:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()

    if not token or not chat_id:
        return False, "На сервере не настроены TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID."

    request_body = json.dumps(
        {
            "chat_id": chat_id,
            "text": message,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=request_body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            response_body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        error.read()
        return False, f"Telegram API вернул ошибку {error.code}. Проверьте токен бота и chat_id."
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        return False, f"Не удалось отправить заявку в Telegram: {error}"

    if not response_body.get("ok"):
        return False, "Telegram API не принял сообщение. Проверьте токен бота и chat_id."

    return True, None


class handler(BaseHTTPRequestHandler):
    def send_json(self, status: HTTPStatus, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Allow", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self) -> None:
        content_length = int(self.headers.get("Content-Length", "0") or 0)

        if content_length <= 0 or content_length > MAX_BODY_SIZE:
            self.send_json(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                {"success": False, "message": "Некорректный размер заявки."},
            )
            return

        try:
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
        except json.JSONDecodeError:
            self.send_json(HTTPStatus.BAD_REQUEST, {"success": False, "message": "Некорректный JSON."})
            return

        if not isinstance(payload, dict):
            self.send_json(HTTPStatus.BAD_REQUEST, {"success": False, "message": "Некорректные данные формы."})
            return

        message, validation_error = build_message(payload)

        if validation_error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"success": False, "message": validation_error})
            return

        assert message is not None
        is_sent, error = send_to_telegram(message)

        if not is_sent:
            self.send_json(
                HTTPStatus.BAD_GATEWAY,
                {"success": False, "message": error or "Не удалось отправить заявку."},
            )
            return

        self.send_json(
            HTTPStatus.OK,
            {"success": True, "message": "Заявка отправлена. Мы скоро свяжемся с вами."},
        )

    def do_GET(self) -> None:
        self.send_json(HTTPStatus.METHOD_NOT_ALLOWED, {"success": False, "message": "Используйте POST."})
