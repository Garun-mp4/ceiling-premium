import {
  calculate,
  defaults,
  validateCalculation,
  money,
  normalizePhone,
  type CalculatorInput,
} from '../lib/pricing';

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
function closeMenu(returnFocus = false) {
  if (menu) menu.hidden = true;
  toggle?.setAttribute('aria-expanded', 'false');
  toggle?.setAttribute('aria-label', 'Открыть меню');
  if (returnFocus) toggle?.focus();
}
toggle?.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') === 'true';
  if (open) closeMenu();
  else {
    if (menu) menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Закрыть меню');
  }
});
menu?.addEventListener('click', (e) => {
  if ((e.target as Element).closest('a')) closeMenu();
});
document.addEventListener('click', (e) => {
  if (!(e.target as Element).closest('.site-header')) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && toggle?.getAttribute('aria-expanded') === 'true') closeMenu(true);
});
matchMedia('(min-width: 761px)').addEventListener('change', (e) => {
  if (e.matches) closeMenu();
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
  submit.disabled = false;
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
    status.textContent = '';
    if (Object.keys(errors).length) {
      event('lead_validation_error');
      (form.elements.namedItem(Object.keys(errors)[0]) as HTMLElement)?.focus();
      return;
    }
    busy = true;
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    status.dataset.state = 'busy';
    status.textContent = 'Отправляем обращение…';
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
    try {
      const response = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) {
        const messages: Record<string, string> = {
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
      status.dataset.state = 'success';
      status.textContent = `Обращение отправлено. Свяжемся с вами для обсуждения проекта. Номер: ${data.requestId || requestId}.`;
      event('lead_success');
      form.reset();
    } catch (error) {
      status.dataset.state = 'error';
      status.textContent =
        error instanceof DOMException && error.name === 'AbortError'
          ? 'Пока нет подтверждения доставки. Не отправляйте повторно сразу — можно связаться с нами в мессенджере.'
          : error instanceof Error
            ? error.message
            : 'Нет соединения. Попробуйте позже или напишите в мессенджер.';
    } finally {
      clearTimeout(timeout);
      busy = false;
      submit.disabled = false;
      form.removeAttribute('aria-busy');
      status.focus({ preventScroll: true });
    }
  });
});

const dialog = $<HTMLDialogElement>('.lightbox');
const photos = $$<HTMLImageElement>('[data-lightbox]');
if (dialog && photos.length) {
  let index = 0;
  let previous: HTMLElement | null = null;
  const image = $<HTMLImageElement>('figure img', dialog)!;
  const caption = $<HTMLElement>('figcaption', dialog)!;
  function showPhoto() {
    const photo = photos[index];
    image.src = photo.dataset.lightbox!;
    image.alt = photo.alt;
    caption.textContent = `${photo.alt} · ${index + 1} / ${photos.length}`;
  }
  function closeViewer() {
    dialog!.close();
    document.body.classList.remove('dialog-open');
    previous?.focus({ preventScroll: true });
  }
  photos.forEach((photo, i) => {
    photo.tabIndex = 0;
    photo.setAttribute('role', 'button');
    photo.setAttribute('aria-label', `Открыть: ${photo.alt}`);
    const open = () => {
      index = i;
      previous = photo;
      showPhoto();
      dialog.showModal();
      document.body.classList.add('dialog-open');
    };
    photo.addEventListener('click', open);
    photo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  });
  $<HTMLButtonElement>('.lightbox-close', dialog)?.addEventListener('click', closeViewer);
  $<HTMLButtonElement>('.lightbox-prev', dialog)?.addEventListener('click', () => {
    index = (index - 1 + photos.length) % photos.length;
    showPhoto();
  });
  $<HTMLButtonElement>('.lightbox-next', dialog)?.addEventListener('click', () => {
    index = (index + 1) % photos.length;
    showPhoto();
  });
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeViewer();
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
