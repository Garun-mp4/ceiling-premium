async function browserSmoke(page) {
  const base = 'http://127.0.0.1:4321';
  const passed = [];
  const verify = (condition, label) => {
    if (!condition) throw new Error(label);
    passed.push(label);
  };
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      '/',
      '/stoimost/',
      '/resheniya/faktury/',
      '/proekty/gostinaya-chistaya-geometriya/',
    ]) {
      await page.goto(base + path);
      await page.evaluate(() => document.fonts.ready);
      verify(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${width}px ${path}: no horizontal overflow`,
      );
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  const menu = page.locator('#mobile-menu');
  await page.locator('.menu-toggle').click();
  verify(await menu.isVisible(), 'mobile menu opens');
  await page.keyboard.press('Escape');
  verify(!(await menu.isVisible()), 'Escape closes menu');
  verify(
    await page.locator('.menu-toggle').evaluate((el) => el === document.activeElement),
    'menu focus returns',
  );
  await page.locator('.menu-toggle').click();
  await menu.getByRole('link', { name: 'Проекты', exact: false }).click();
  verify(new URL(page.url()).pathname === '/proekty/', 'mobile navigation works');
  await page.getByRole('button', { name: 'Кухня', exact: true }).click();
  verify(
    (await page.locator('[data-project]:visible').count()) === 1,
    'room filter shows correct project',
  );
  await page.getByRole('button', { name: 'Все', exact: true }).click();
  verify((await page.locator('[data-project]:visible').count()) === 6, 'all projects restored');
  await page.goto(base + '/proekty/gostinaya-chistaya-geometriya/');
  const image = page.locator('[data-lightbox]').first();
  await image.focus();
  await page.keyboard.press('Enter');
  verify(await page.locator('dialog').evaluate((el) => el.open), 'gallery opens from keyboard');
  const firstCaption = await page.locator('dialog figcaption').textContent();
  await page.keyboard.press('ArrowRight');
  verify(
    (await page.locator('dialog figcaption').textContent()) !== firstCaption,
    'gallery arrow changes photo',
  );
  await page.keyboard.press('Escape');
  verify(await image.evaluate((el) => el === document.activeElement), 'gallery restores focus');
  await page.getByRole('link', { name: 'Рассчитать похожее', exact: false }).click();
  verify(
    (await page.locator('[data-calculator] [name=area]').inputValue()) === '24',
    'project area prefilled',
  );
  verify(
    (await page.locator('[data-calculator] [name=profile]').inputValue()) === 'shadow',
    'project profile prefilled',
  );
  verify(
    (await page.locator('[data-price-range]').textContent()).replace(/\s/g, '').includes('36460₽'),
    'project price agrees',
  );
  await page.locator('[data-calculator] [name=area]').fill('18,5');
  verify(
    (await page.locator('[data-calculator] [name=area]').getAttribute('aria-invalid')) === 'false',
    'decimal comma accepted',
  );
  await page.locator('[data-calculator] [name=area]').fill('201');
  verify(
    (await page.locator('[data-estimate-cta]').getAttribute('aria-disabled')) === 'true',
    'invalid calculation blocked',
  );
  await page.locator('[data-calculator] [name=area]').fill('18,5');
  await page.goto(base + '/stoimost/');
  verify(
    (await page.locator('[data-calculator] [name=area]').inputValue()) === '18.5',
    'calculation restored in session',
  );
  await page.goto(base + '/kontakty/');
  const form = page.locator('[data-lead-form]');
  await form.locator('button[type=submit]').click();
  verify(
    (await form.locator('[data-error=phone]').textContent()) !== '',
    'phone field error shown',
  );
  await form.locator('[name=phone]').fill('8 (996) 420-65-69');
  verify(
    (await form.locator('[name=phone]').inputValue()) === '8 (996) 420-65-69',
    'phone input preserves pasted value',
  );
  await form.locator('[name=phone]').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('Delete');
  await page.keyboard.type('8');
  verify(
    (await form.locator('[name=phone]').inputValue()) === '8 (996) 420-65-69',
    'phone editing does not rewrite digits',
  );
  await form.locator('[name=comment]').fill('Проверка ошибки и повтора');
  await form.locator('[name=privacyConsent]').check();
  let calls = 0;
  let payload;
  await page.route('**/api/lead', async (route) => {
    calls++;
    payload = route.request().postDataJSON();
    await new Promise((resolve) => setTimeout(resolve, 120));
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
  await form.locator('button[type=submit]').dblclick();
  await form.locator('.form-status[data-state=error]').waitFor();
  verify(calls === 1, 'double press sends only once');
  verify(
    (await form.locator('[name=comment]').inputValue()) === 'Проверка ошибки и повтора',
    'server error preserves fields',
  );
  verify(payload.phone === '+79964206569', 'phone normalized only for payload');
  const originalId = payload.requestId;
  await form.locator('button[type=submit]').click();
  await form.locator('.form-status[data-state=success]').waitFor();
  verify(calls === 2 && payload.requestId === originalId, 'retry keeps idempotency key');
  verify(
    (await form.locator('.form-status').textContent()).includes(originalId),
    'confirmed success shown',
  );
  verify(
    !(await form.locator('[name=privacyConsent]').isChecked()),
    'consent resets unchecked after success',
  );
  await page.unroute('**/api/lead');
  await page.goto(base);
  const faq = page.locator('.faq-list details').first();
  await faq.locator('summary').click();
  verify((await faq.getAttribute('open')) !== null, 'FAQ uses native disclosure');
  verify((await page.locator('a[href="tel:+79964206569"]').count()) > 0, 'real phone link present');
  verify(
    (await page.locator('a[href="https://t.me/garun_web"]').count()) > 0,
    'Telegram link present',
  );
  verify(
    (await page.locator('a[href="https://wa.me/79964206569"]').count()) > 0,
    'WhatsApp link present',
  );
  verify(errors.length === 0, 'no application exceptions');
  return { passed: passed.length, checks: passed };
}
