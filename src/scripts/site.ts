import {
  calculate,
  defaults,
  validateCalculation,
  money,
  normalizePhone,
  type CalculatorInput,
} from '../lib/pricing';
import { cancelMotion, initPhotoReveals, setMenuOpen, tween } from './motion';

initPhotoReveals();

declare global {
  interface Window {
    ym?: ((...args: unknown[]) => void) & { a?: unknown[][]; l?: number };
  }
}
const $ = <T extends Element>(selector: string, parent: ParentNode = document) =>
  parent.querySelector<T>(selector);
const $$ = <T extends Element>(selector: string, parent: ParentNode = document) =>
  Array.from(parent.querySelectorAll<T>(selector));
const storage = {
  get(key: string) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      /* Storage may be disabled; interactions remain available. */
    }
  },
};
const analyticsId = Number(document.body.dataset.metrika);
let analyticsAllowed = false;
let analyticsInitialized = false;
function event(name: string) {
  if (analyticsAllowed && analyticsId && window.ym)
    window.ym(analyticsId, 'reachGoal', name, { page: location.pathname });
}
function startAnalytics() {
  if (
    !analyticsId ||
    !Number.isSafeInteger(analyticsId) ||
    analyticsId <= 0 ||
    analyticsInitialized
  )
    return;
  if (!window.ym) {
    const ym: NonNullable<Window['ym']> = (...args: unknown[]) => {
      ym.a ??= [];
      ym.a.push(args);
    };
    ym.l = Date.now();
    window.ym = ym;
    const script = document.createElement('script');
    script.src = 'https://mc.yandex.ru/metrika/tag.js';
    script.async = true;
    document.head.append(script);
  }
  window.ym(analyticsId, 'init', {
    clickmap: false,
    trackLinks: false,
    accurateTrackBounce: true,
    webvisor: false,
    trackHash: false,
  });
  analyticsInitialized = true;
}
function consentStorage(value?: string) {
  try {
    if (value) localStorage.setItem('pole.analytics.v1', value);
    return localStorage.getItem('pole.analytics.v1');
  } catch {
    return null;
  }
}
const cookieBanner = $<HTMLElement>('.cookie-banner');
if (analyticsId > 0) {
  const accepted = consentStorage() === 'accepted';
  analyticsAllowed = accepted;
  if (accepted) startAnalytics();
  if (cookieBanner) cookieBanner.hidden = !!consentStorage();
  $$<HTMLButtonElement>('[data-cookie-settings]').forEach((b) => {
    b.hidden = false;
    b.addEventListener('click', () => {
      if (cookieBanner) cookieBanner.hidden = false;
    });
  });
  $<HTMLButtonElement>('[data-cookie-accept]')?.addEventListener('click', () => {
    consentStorage('accepted');
    analyticsAllowed = true;
    startAnalytics();
    if (cookieBanner) cookieBanner.hidden = true;
  });
  $<HTMLButtonElement>('[data-cookie-reject]')?.addEventListener('click', () => {
    consentStorage('rejected');
    analyticsAllowed = false;
    if (window.ym && analyticsInitialized) window.ym(analyticsId, 'destruct');
    analyticsInitialized = false;
    if (cookieBanner) cookieBanner.hidden = true;
  });
}
$$<HTMLElement>('[data-event]').forEach((node) =>
  node.addEventListener('click', () => event(node.dataset.event!)),
);

const menu = $<HTMLElement>('#mobile-menu'),
  toggle = $<HTMLButtonElement>('.menu-toggle');
function closeMenu(returnFocus = false, instant = false) {
  if (menu) setMenuOpen(menu, false, instant || returnFocus);
  toggle?.setAttribute('aria-expanded', 'false');
  toggle?.setAttribute('aria-label', 'Открыть меню');
  if (returnFocus) toggle?.focus();
}
toggle?.addEventListener('click', (e) => {
  const open = toggle.getAttribute('aria-expanded') === 'true';
  if (open) closeMenu(false, e.detail === 0);
  else {
    if (menu) setMenuOpen(menu, true, e.detail === 0);
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Закрыть меню');
  }
});
menu?.addEventListener('click', (e) => {
  if ((e.target as Element).closest('a')) closeMenu(false, true);
});
document.addEventListener('click', (e) => {
  if (!(e.target as Element).closest('.site-header')) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && toggle?.getAttribute('aria-expanded') === 'true') closeMenu(true);
});
matchMedia('(min-width: 761px)').addEventListener('change', (e) => {
  if (e.matches) closeMenu(false, true);
});

const filters = $<HTMLElement>('[data-project-filters]');
if (filters) {
  const buttons = $$<HTMLButtonElement>('[data-filter]', filters);
  const allowed = buttons.map((b) => b.dataset.filter!);
  function applyFilter(value: string) {
    const selection = allowed.includes(value) ? value : 'Все';
    let count = 0;
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === selection)));
    $$<HTMLElement>('[data-project]').forEach((card) => {
      card.hidden = selection !== 'Все' && card.dataset.room !== selection;
      if (!card.hidden) count++;
    });
    const status = $<HTMLElement>('[data-filter-result]');
    if (status)
      status.textContent = `${count} ${count === 1 ? 'проект' : count >= 2 && count <= 4 ? 'проекта' : 'проектов'}`;
  }
  applyFilter(new URL(location.href).searchParams.get('room') || 'Все');
  buttons.forEach((button) =>
    button.addEventListener('click', () => {
      const value = button.dataset.filter!;
      applyFilter(value);
      const url = new URL(location.href);
      if (value === 'Все') url.searchParams.delete('room');
      else url.searchParams.set('room', value);
      history.replaceState(null, '', url);
    }),
  );
  window.addEventListener('popstate', () =>
    applyFilter(new URL(location.href).searchParams.get('room') || 'Все'),
  );
}

let currentCalculation: CalculatorInput | null = null;
let calculationSource: string | null = null;
function restoreCalculation() {
  try {
    const saved = JSON.parse(storage.get('pole.calculation.v1') || 'null');
    if (saved && typeof saved === 'object') {
      const result = validateCalculation(saved);
      if (result.input) currentCalculation = result.input;
    }
  } catch {
    /* Invalid or old browser state is ignored. */
  }
}
restoreCalculation();
const calculator = $<HTMLFormElement>('[data-calculator]');
if (calculator) {
  let started = false;
  let selected: Record<string, unknown> = { ...(currentCalculation || defaults) };
  const params = new URL(location.href).searchParams;
  try {
    const presets = JSON.parse(
      $<HTMLScriptElement>('[data-presets]', calculator)?.textContent || '{}',
    );
    const project = params.get('project'),
      solution = params.get('solution');
    if (project && Object.hasOwn(presets.projects, project)) {
      selected = { ...defaults, ...presets.projects[project] };
      started = true;
      calculationSource = `project:${project}`;
    } else if (solution && Object.hasOwn(presets.solutions, solution)) {
      selected = { ...defaults, ...presets.solutions[solution] };
      started = true;
      calculationSource = `solution:${solution}`;
    }
  } catch {
    /* Prerendered defaults remain usable if preset data is unavailable. */
  }
  for (const [key, value] of Object.entries(selected)) {
    const field = calculator.elements.namedItem(key);
    if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement)
      field.value = String(value);
  }
  function update(persist: boolean) {
    const raw = Object.fromEntries(new FormData(calculator!).entries());
    const result = validateCalculation(raw);
    $$<HTMLElement>('[data-calc-error]', calculator!).forEach((node) => {
      const key = node.dataset.calcError!;
      node.textContent = result.errors[key] || '';
      const field = calculator!.elements.namedItem(key);
      if (field instanceof HTMLElement) {
        field.setAttribute('aria-invalid', String(!!result.errors[key]));
        if (!node.id) node.id = `calc-error-${key}`;
        field.setAttribute('aria-describedby', node.id);
      }
    });
    const price = $<HTMLOutputElement>('[data-price-range]', calculator!);
    const invalid = $<HTMLElement>('[data-calculation-error]', calculator!);
    const cta = $<HTMLAnchorElement>('[data-estimate-cta]', calculator!);
    if (!result.input) {
      currentCalculation = null;
      if (price) price.textContent = 'Проверьте параметры';
      if (invalid) invalid.hidden = false;
      if (cta) {
        cta.setAttribute('aria-disabled', 'true');
        cta.tabIndex = -1;
      }
      storage.set('pole.calculation.v1', 'null');
      return;
    }
    if (invalid) invalid.hidden = true;
    if (cta) {
      cta.removeAttribute('aria-disabled');
      cta.tabIndex = 0;
    }
    const estimate = calculate(result.input);
    if (price) price.textContent = `${money(estimate.low)} – ${money(estimate.high)}`;
    const rows = $<HTMLElement>('[data-estimate-rows]', calculator!);
    if (rows) {
      rows.replaceChildren();
      for (const row of [
        ...estimate.rows,
        ...(estimate.minimumAdjustment > 0
          ? [
              {
                label: 'До минимального заказа',
                quantity: 0,
                unit: '',
                rate: 0,
                total: estimate.minimumAdjustment,
              },
            ]
          : []),
      ]) {
        const div = document.createElement('div');
        div.className = 'estimate-row';
        const label = document.createElement('span');
        label.textContent = `${row.label}${row.quantity ? ` · ${row.quantity} ${row.unit}` : ''}`;
        const cost = document.createElement('strong');
        cost.textContent = money(row.total);
        div.append(label, cost);
        rows.append(div);
      }
    }
    if (persist) {
      currentCalculation = result.input;
      storage.set('pole.calculation.v1', JSON.stringify(result.input));
    }
  }
  calculator.addEventListener('input', () => {
    if (!started) {
      started = true;
      event('calculator_start');
    }
    update(true);
  });
  calculator.addEventListener('change', (e) => {
    if (
      (e.target as HTMLInputElement).name === 'material' ||
      (e.target as HTMLInputElement).name === 'profile'
    )
      event('solution_change');
    update(true);
  });
  calculator.addEventListener('submit', (e) => e.preventDefault());
  $<HTMLAnchorElement>('[data-estimate-cta]', calculator)?.addEventListener('click', (e) => {
    if ((e.currentTarget as HTMLAnchorElement).hasAttribute('aria-disabled')) {
      e.preventDefault();
      return;
    }
    update(true);
    requestAnimationFrame(() => {
      $<HTMLInputElement>('[data-lead-form] [name=phone]')?.focus({ preventScroll: true });
    });
  });
  update(started);
}

$$<HTMLFormElement>('[data-lead-form]').forEach((form) => {
  const status = $<HTMLElement>('.form-status', form)!;
  const submit = $<HTMLButtonElement>('button[type=submit]', form)!;
  const submitLabel = $<HTMLElement>('[data-submit-label]', submit)!;
  submit.disabled = false;
  const resultContent = $<HTMLElement>('[data-status-content]', status)!;
  const statusTitle = $<HTMLElement>('[data-status-title]', status)!;
  const statusMessage = $<HTMLElement>('[data-status-message]', status)!;
  const retry = $<HTMLButtonElement>('[data-status-retry]', status)!;
  function showStatus(
    state: 'busy' | 'success' | 'error' | 'uncertain' | null,
    title = '',
    message = '',
  ) {
    cancelMotion(status);
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
    resultContent.hidden = !state;
    statusTitle.textContent = title;
    statusMessage.textContent = message;
    retry.hidden = state !== 'error' && state !== 'uncertain';
    retry.textContent = state === 'uncertain' ? 'Проверить ещё раз' : 'Попробовать ещё раз';
    if (state && state !== 'busy')
      tween(
        status,
        [
          { opacity: 0.65, transform: 'translateY(6px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 240 },
      );
  }
  retry.addEventListener('click', () => form.requestSubmit(submit));
  let busy = false;
  let requestId = crypto.randomUUID();
  let submitted = false;
  let started = false;
  form.addEventListener('input', () => {
    if (!started) {
      started = true;
      event('lead_start');
    }
    if (submitted) {
      submitted = false;
      requestId = crypto.randomUUID();
      submit.disabled = false;
      submitLabel.textContent = 'Обсудить мой проект';
      showStatus(null);
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || submitted) return;
    const values = new FormData(form);
    const errors: Record<string, string> = {};
    const rawPhone = String(values.get('phone') || '');
    const phone = normalizePhone(rawPhone);
    const name = String(values.get('name') || '').trim();
    const comment = String(values.get('comment') || '').trim();
    if (!phone) errors.phone = 'Введите российский номер: +7 и 10 цифр.';
    if (name.length > 80) errors.name = 'Имя не должно быть длиннее 80 символов.';
    if (comment.length > 1000) errors.comment = 'Сократите комментарий до 1 000 символов.';
    if (!values.has('privacyConsent')) errors.privacyConsent = 'Для отправки нужно ваше согласие.';
    $$<HTMLElement>('[data-error]', form).forEach((node) => {
      const key = node.dataset.error!;
      node.textContent = errors[key] || '';
      if (!node.id) node.id = `lead-${form.dataset.source?.replace(/[^a-z]/gi, '')}-${key}-error`;
      const field = form.elements.namedItem(key);
      if (field instanceof HTMLElement) {
        field.setAttribute('aria-invalid', String(!!errors[key]));
        field.setAttribute('aria-describedby', node.id);
      }
    });
    showStatus(null);
    if (Object.keys(errors).length) {
      event('lead_validation_error');
      (form.elements.namedItem(Object.keys(errors)[0]) as HTMLElement)?.focus();
      return;
    }
    busy = true;
    submit.disabled = true;
    submitLabel.textContent = 'Отправляем обращение';
    form.setAttribute('aria-busy', 'true');
    showStatus('busy', 'Отправляем обращение', 'Дождитесь подтверждения отправки.');
    const utm: Record<string, string> = {};
    const search = new URL(location.href).searchParams;
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      const value = search.get(key);
      if (value) utm[key] = value.slice(0, 100);
    }
    const payload = {
      name,
      phone,
      comment,
      privacyConsent: true,
      consentVersion: '2026-10-18',
      source: calculationSource || form.dataset.source || 'contact',
      page: location.pathname,
      calculator: currentCalculation,
      utm,
      website: String(values.get('website') || ''),
      requestId,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18000);
    let responseReceived = false;
    let uncertain = false;
    try {
      const response = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      responseReceived = true;
      if (!response.ok || data.ok !== true) {
        uncertain = data.error === 'delivery_pending' || response.status === 409 || !data.error;
        const messages: Record<string, string> = {
          delivery_unavailable:
            'Сервис отправки временно недоступен. Повторите попытку или напишите нам в Telegram / WhatsApp.',
          rate_limited: 'Слишком много обращений. Подождите минуту или напишите нам напрямую.',
          phone_required: 'Проверьте номер телефона.',
          privacy_consent_required: 'Подтвердите согласие на обработку данных.',
          invalid_calculator: 'Параметры расчёта изменились. Проверьте их в калькуляторе.',
          delivery_pending:
            'Обращение ещё обрабатывается. Подождите немного, прежде чем повторять отправку.',
        };
        throw new Error(
          messages[data.error] ||
            'Не удалось подтвердить отправку. Попробуйте позже или напишите в Telegram / WhatsApp.',
        );
      }
      submitted = true;
      showStatus(
        'success',
        'Обращение отправлено',
        `Свяжемся с вами для обсуждения проекта. Номер обращения: ${data.requestId || requestId}.`,
      );
      event('lead_success');
      form.reset();
    } catch (error) {
      const pending = uncertain || !responseReceived;
      const message = pending
        ? 'Пока нет подтверждения доставки. Подождите немного, затем проверьте отправку ещё раз или напишите нам в Telegram / WhatsApp.'
        : error instanceof Error
          ? error.message
          : 'Не удалось отправить обращение. Попробуйте позже или напишите в мессенджер.';
      showStatus(
        pending ? 'uncertain' : 'error',
        pending ? 'Пока нет подтверждения' : 'Не получилось отправить',
        message,
      );
    } finally {
      clearTimeout(timeout);
      busy = false;
      submit.disabled = submitted;
      submitLabel.textContent = submitted ? 'Обращение отправлено' : 'Обсудить мой проект';
      form.removeAttribute('aria-busy');
      const bounds = submit.getBoundingClientRect();
      status.focus({ preventScroll: bounds.top >= innerHeight || bounds.bottom <= 0 });
    }
  });
});

const dialog = $<HTMLDialogElement>('.lightbox');
const photos = $$<HTMLImageElement>('[data-lightbox]');
if (dialog && photos.length) {
  let index = 0;
  let previous: HTMLElement | null = null;
  let photoRequest = 0;
  const image = $<HTMLImageElement>('figure img', dialog)!;
  const caption = $<HTMLElement>('figcaption', dialog)!;
  function showPhoto(direction = 0, instant = true) {
    const photo = photos[index];
    const request = ++photoRequest;
    cancelMotion(image);
    // Show the available photograph immediately, then upgrade it after decoding.
    image.src = photo.currentSrc || photo.src;
    image.alt = photo.alt;
    caption.textContent = `${photo.alt} · ${index + 1} / ${photos.length}`;
    if (!instant)
      tween(
        image,
        [
          { opacity: 0.7, transform: `translateX(${direction * 8}px) scale(.99)` },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 200 },
      );
    const full = new Image();
    full.src = photo.dataset.lightbox!;
    full.decode().then(
      () => {
        if (request === photoRequest && dialog!.open) image.src = full.src;
      },
      () => {
        /* The rendered photograph remains available if the larger file fails. */
      },
    );
  }
  function closeViewer(instant = false) {
    if (!dialog!.open) return;
    dialog!.dataset.closing = 'true';
    const current = getComputedStyle(dialog!);
    tween(
      dialog!,
      [
        { opacity: current.opacity, transform: current.transform },
        { opacity: 0, transform: 'scale(.98)' },
      ],
      {
        duration: 160,
        instant,
        finish: () => {
          dialog!.close();
          delete dialog!.dataset.closing;
          document.body.classList.remove('dialog-open');
          previous?.focus({ preventScroll: true });
        },
      },
    );
  }
  photos.forEach((photo, i) => {
    photo.tabIndex = 0;
    photo.setAttribute('role', 'button');
    photo.setAttribute('aria-label', `Открыть: ${photo.alt}`);
    const open = (instant = false) => {
      index = i;
      previous = photo;
      showPhoto();
      delete dialog.dataset.closing;
      dialog.showModal();
      document.body.classList.add('dialog-open');
      tween(
        dialog,
        [
          { opacity: 0, transform: 'scale(.98)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 240, instant },
      );
    };
    photo.addEventListener('click', (e) => open(e.detail === 0));
    photo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(true);
      }
    });
  });
  $<HTMLButtonElement>('.lightbox-close', dialog)?.addEventListener('click', (e) =>
    closeViewer(e.detail === 0),
  );
  $<HTMLButtonElement>('.lightbox-prev', dialog)?.addEventListener('click', (e) => {
    index = (index - 1 + photos.length) % photos.length;
    showPhoto(-1, e.detail === 0);
  });
  $<HTMLButtonElement>('.lightbox-next', dialog)?.addEventListener('click', (e) => {
    index = (index + 1) % photos.length;
    showPhoto(1, e.detail === 0);
  });
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeViewer(true);
  });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') {
      index = (index + 1) % photos.length;
      showPhoto();
    }
    if (e.key === 'ArrowLeft') {
      index = (index - 1 + photos.length) % photos.length;
      showPhoto();
    }
  });
}
