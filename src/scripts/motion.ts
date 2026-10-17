const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const active = new Map<HTMLElement, { animation: Animation; finish?: () => void }>();
const easeOut = 'cubic-bezier(0.23, 1, 0.32, 1)';

document.addEventListener(
  'keydown',
  () => {
    document.documentElement.dataset.input = 'keyboard';
  },
  { capture: true },
);
document.addEventListener(
  'pointerdown',
  () => {
    document.documentElement.dataset.input = 'pointer';
  },
  { capture: true, passive: true },
);
document.addEventListener(
  'wheel',
  () => {
    document.documentElement.dataset.input = 'pointer';
  },
  { passive: true },
);

export const canMove = () =>
  !reducedMotion.matches && document.documentElement.dataset.input !== 'keyboard';

export function cancelMotion(element: HTMLElement) {
  active.get(element)?.animation.cancel();
  active.delete(element);
}

/** Retargetable WAAPI motion; cancellation always leaves readable native content. */
export function tween(
  element: HTMLElement,
  frames: Keyframe[],
  options: { duration: number; instant?: boolean; finish?: () => void },
) {
  cancelMotion(element);
  if (
    options.instant ||
    document.documentElement.dataset.input === 'keyboard' ||
    !element.animate
  ) {
    options.finish?.();
    return;
  }
  const keyframes = reducedMotion.matches
    ? frames.map((frame) => ({ opacity: frame.opacity ?? 1 }))
    : frames;
  const animation = element.animate(keyframes, {
    duration: reducedMotion.matches ? 90 : options.duration,
    easing: easeOut,
  });
  const record = { animation, finish: options.finish };
  active.set(element, record);
  animation.finished.then(
    () => {
      if (active.get(element) !== record) return;
      active.delete(element);
      options.finish?.();
    },
    () => {
      // Interrupted transitions are expected, e.g. closing a menu during its entrance.
      if (active.get(element) === record) active.delete(element);
    },
  );
}

export function setMenuOpen(menu: HTMLElement, open: boolean, instant = false) {
  const wasHidden = menu.hidden;
  if (wasHidden && !open) return;
  const current = getComputedStyle(menu);
  const start = {
    opacity: wasHidden ? 0 : current.opacity,
    transform: wasHidden ? 'translateY(-8px)' : current.transform,
  };
  menu.hidden = false;
  menu.inert = !open;
  tween(menu, [start, { opacity: open ? 1 : 0, transform: open ? 'none' : 'translateY(-8px)' }], {
    duration: open ? 220 : 160,
    instant,
    finish: () => {
      menu.hidden = !open;
      menu.inert = !open;
    },
  });
}

function settleMotion() {
  for (const [element, record] of [...active]) {
    cancelMotion(element);
    record.finish?.();
  }
}
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) settleMotion();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) settleMotion();
});
window.addEventListener('pageswap', (event) => {
  if (!canMove())
    (
      event as Event & { viewTransition?: { skipTransition: () => void } }
    ).viewTransition?.skipTransition();
});
const clearSelection = () =>
  document
    .querySelectorAll<HTMLElement>('[data-transition-name]')
    .forEach((frame) => frame.style.removeProperty('view-transition-name'));
document.addEventListener(
  'click',
  (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
    if (!link || link.target === '_blank') return;
    const destination = new URL(link.href);
    if (destination.origin !== location.origin || destination.pathname === location.pathname)
      return;
    clearSelection();
    const frame = link.querySelector<HTMLElement>('[data-transition-name]');
    if (frame && canMove()) {
      cancelMotion(frame);
      frame.style.viewTransitionName = frame.dataset.transitionName!;
    }
  },
  { capture: true },
);
window.addEventListener('pagereveal', (event) => {
  const transition = (event as Event & { viewTransition?: { finished: Promise<void> } })
    .viewTransition;
  if (transition) transition.finished.then(clearSelection, clearSelection);
  else clearSelection();
});

// Only photographs below the initial viewport receive a one-time entrance.
// No initial hidden styles, scroll loops, or animation on calculator values.
export function initPhotoReveals() {
  if (!('IntersectionObserver' in window) || reducedMotion.matches) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const frame = entry.target as HTMLElement;
        observer.unobserve(frame);
        frame.dataset.revealed = 'true';
        const reveal = () => {
          if (!canMove()) return;
          tween(
            frame,
            [
              { opacity: 0.82, transform: 'translateY(12px)', clipPath: 'inset(3% 0 0 0)' },
              { opacity: 1, transform: 'none', clipPath: 'inset(0 0 0 0)' },
            ],
            { duration: 600 },
          );
        };
        const image = frame.querySelector('img');
        if (image && !image.complete) image.addEventListener('load', reveal, { once: true });
        else reveal();
      }
    },
    { rootMargin: '0px 0px 72px 0px', threshold: 0 },
  );
  document
    .querySelectorAll<HTMLElement>(
      '.project-image,.lighting-media,.process-photo,.article-image,.variants-grid .media',
    )
    .forEach((frame) => {
      if (frame.getBoundingClientRect().top >= innerHeight) observer.observe(frame);
    });
}
