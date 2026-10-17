async function browserMotion(page) {
  const base = 'http://127.0.0.1:4321';
  const passed = [];
  const verify = (condition, label) => {
    if (!condition) throw new Error(label);
    passed.push(label);
  };
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  const menu = page.locator('#mobile-menu'),
    toggle = page.locator('.menu-toggle');
  await toggle.click();
  await toggle.dispatchEvent('click', { detail: 1 });
  await toggle.dispatchEvent('click', { detail: 1 });
  await page.waitForFunction(
    () => document.querySelector('#mobile-menu').getAnimations().length === 0,
  );
  verify(
    (await menu.isVisible()) && !(await menu.evaluate((el) => el.inert)),
    'interrupted menu settles open',
  );
  await page.keyboard.press('Escape');
  verify(!(await menu.isVisible()), 'Escape closes immediately during normal motion');
  await toggle.focus();
  await page.keyboard.press('Enter');
  verify(
    await menu.evaluate((el) => el.getAnimations().length === 0),
    'keyboard menu has no entrance delay',
  );
  await page.keyboard.press('Escape');
  await page.goto(base + '/proekty/gostinaya-chistaya-geometriya/');
  await page.locator('[data-lightbox]').first().click();
  verify(await page.locator('dialog').evaluate((el) => el.open), 'pointer gallery opens');
  await page.keyboard.press('Escape');
  verify(
    !(await page.locator('dialog').evaluate((el) => el.open)),
    'Escape interrupts gallery entrance',
  );
  await page.locator('[data-lightbox]').first().click();
  await page.locator('.lightbox-close').click();
  await page.waitForFunction(() => !document.querySelector('dialog').open);
  verify(
    !(await page.locator('body').evaluate((el) => el.classList.contains('dialog-open'))),
    'pointer close releases body after exit',
  );
  await page.goto(base + '/kontakty/');
  const form = page.locator('[data-lead-form]');
  let calls = 0;
  const requests = [];
  await page.route('**/api/lead', async (route) => {
    calls++;
    const payload = route.request().postDataJSON();
    requests.push(payload);
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (calls === 3) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status: calls === 1 ? 503 : 200,
      contentType: 'application/json',
      body: JSON.stringify(
        calls === 1
          ? { ok: false, error: 'delivery_unavailable' }
          : { ok: true, requestId: payload.requestId },
      ),
    });
  });
  await form.locator('[name=phone]').fill('8 (996) 420-65-69');
  await form.locator('[name=comment]').fill('Проверка анимации');
  await form.locator('[name=privacyConsent]').check();
  await form.locator('button[type=submit]').click();
  verify((await form.getAttribute('aria-busy')) === 'true', 'busy state starts before response');
  verify(await form.locator('.submit-spinner').isVisible(), 'loading indicator visible');
  verify(await form.locator('button[type=submit]').isDisabled(), 'busy submission disabled');
  await form.locator('.form-status[data-state=error]').waitFor();
  verify(await form.locator('.status-cross').isVisible(), 'explicit error has distinct icon');
  verify(
    (await form.locator('[name=comment]').inputValue()) === 'Проверка анимации',
    'error preserves visitor input',
  );
  await form.locator('[data-status-retry]').click();
  await form.locator('.form-status[data-state=success]').waitFor();
  verify(
    await form.locator('.status-check').isVisible(),
    'success check appears after positive response',
  );
  verify(!(await form.locator('[data-status-retry]').isVisible()), 'success has no retry action');
  verify(requests[0].requestId === requests[1].requestId, 'retry preserves idempotency key');
  verify(
    (await form.locator('[data-status-message]').textContent()).includes(requests[1].requestId),
    'success contains confirmed request number',
  );
  await form.locator('[name=phone]').fill('9964206569');
  await form.locator('[name=comment]').fill('Сетевой сбой');
  await form.locator('[name=privacyConsent]').check();
  await form.locator('button[type=submit]').click();
  await form.locator('.form-status[data-state=uncertain]').waitFor();
  verify(
    await form.locator('.status-wait').isVisible(),
    'network failure is not presented as confirmed rejection',
  );
  verify(
    (await form.locator('[name=comment]').inputValue()) === 'Сетевой сбой',
    'network failure preserves visitor input',
  );
  verify(
    !(await form.locator('.status-check').isVisible()),
    'no success animation on network failure',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await form.locator('[data-status-retry]').click();
  await form.locator('.form-status[data-state=success]').waitFor();
  verify(
    await form
      .locator('.form-status')
      .evaluate((el) =>
        el.getAnimations().every((a) => a.effect.getKeyframes().every((k) => !k.transform)),
      ),
    'reduced motion feedback only fades',
  );
  verify(
    await form.locator('.status-check path').evaluate((el) => el.getAnimations().length === 0),
    'reduced motion shows static check',
  );
  await page.unroute('**/api/lead');
  await page.goto(base);
  verify(
    await page.locator('.hero-image .media').evaluate((el) => el.getAnimations().length === 0),
    'reduced motion disables hero movement',
  );
  await toggle.click();
  await page.waitForFunction(
    () => document.querySelector('#mobile-menu').getAnimations().length === 0,
  );
  verify(await menu.isVisible(), 'reduced motion menu stays usable');
  await page.keyboard.press('Escape');
  verify(errors.length === 0, 'no application exceptions');
  return { passed: passed.length, checks: passed };
}
