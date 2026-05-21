const materialRates = {
  matte: 299,
  satin: 390,
  gloss: 450,
};

const formatter = new Intl.NumberFormat("ru-RU");
const leadFormGenericError =
  "Не удалось отправить заявку. Пожалуйста, попробуйте позже.";
const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampInput(input, fallback) {
  const min = toNumber(input.min, Number.NEGATIVE_INFINITY);
  const max = toNumber(input.max, Number.POSITIVE_INFINITY);
  return Math.min(Math.max(toNumber(input.value, fallback), min), max);
}

function formatPrice(value) {
  return `${formatter.format(Math.round(value))} ₽`;
}

function normalizePhoneDigits(phoneValue) {
  const digits = phoneValue.replace(/\D/g, "");

  if (digits.length === 10) {
    return `7${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("8")) {
    return `7${digits.slice(1)}`;
  }

  return digits.slice(0, 11);
}

function formatPhone(phoneValue) {
  const digits = normalizePhoneDigits(phoneValue);
  let formatted = "+7";

  if (digits.length > 1) {
    formatted += ` (${digits.slice(1, 4)}`;
  }
  if (digits.length >= 4) {
    formatted += `) ${digits.slice(4, 7)}`;
  }
  if (digits.length >= 7) {
    formatted += `-${digits.slice(7, 9)}`;
  }
  if (digits.length >= 9) {
    formatted += `-${digits.slice(9, 11)}`;
  }

  return formatted;
}

function validatePhone(phoneValue) {
  return normalizePhoneDigits(phoneValue).length === 11;
}

function setFormStatus(node, message, type) {
  if (!node) {
    return;
  }

  node.textContent = message;
  node.classList.remove("form-status--error", "form-status--success");

  if (type) {
    node.classList.add(`form-status--${type}`);
  }
}

function getLeadFormErrorMessage(errorCode) {
  const messages = {
    name_required: "Введите имя, минимум 2 символа.",
    phone_required: "Проверьте номер телефона: нужен российский номер из 11 цифр.",
    privacy_consent_required:
      "Подтвердите согласие на обработку персональных данных.",
  };

  return messages[errorCode] || leadFormGenericError;
}

function initYear() {
  document.querySelectorAll("[data-year], #year").forEach((node) => {
    node.textContent = new Date().getFullYear();
  });
}

function initCalculator() {
  const form = document.querySelector("#price-form");
  const leadSection = document.querySelector("#lead-form");
  const leadPhone = document.querySelector("#lead-phone");

  if (!form) {
    return;
  }

  const areaInput = form.querySelector("#area");
  const materialInput = form.querySelector("#material");
  const cornersInput = form.querySelector("#corners");
  const lightsInput = form.querySelector("#lights");
  const pipesInput = form.querySelector("#pipes");
  const rushInput = form.querySelector("#rush");
  const priceRange = form.querySelector("#price-range");
  const priceMeta = form.querySelector("#price-meta");
  const leadEstimate = document.querySelector("#lead-estimate");

  const requiredNodes = [
    areaInput,
    materialInput,
    cornersInput,
    lightsInput,
    pipesInput,
    rushInput,
    priceRange,
    priceMeta,
  ];

  if (requiredNodes.some((node) => !node)) {
    return;
  }

  function calculateEstimate() {
    const area = clampInput(areaInput, 6);
    const corners = clampInput(cornersInput, 4);
    const lights = clampInput(lightsInput, 0);
    const pipes = clampInput(pipesInput, 0);
    const materialRate =
      materialRates[materialInput.value] || materialRates.matte;

    const base = area * materialRate;
    const cornerExtra = Math.max(corners - 4, 0) * 250;
    const lightsExtra = lights * 600;
    const pipesExtra = pipes * 350;
    const rushMultiplier = rushInput.checked ? 1.15 : 1;
    const total = Math.max(
      (base + cornerExtra + lightsExtra + pipesExtra) * rushMultiplier,
      9000,
    );
    const low = total * 0.95;
    const high = total * 1.1;
    const materialText =
      materialInput.options[materialInput.selectedIndex].text;

    priceRange.textContent = `${formatPrice(low)} - ${formatPrice(high)}`;
    priceMeta.textContent = `Площадь ${area} м², материал "${materialText}"${
      rushInput.checked ? ", срочный монтаж" : ""
    }`;

    if (leadEstimate) {
      leadEstimate.value = priceRange.textContent;
    }
  }

  [
    areaInput,
    materialInput,
    cornersInput,
    lightsInput,
    pipesInput,
    rushInput,
  ].forEach((input) => {
    input.addEventListener("input", calculateEstimate);
    input.addEventListener("change", calculateEstimate);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    calculateEstimate();

    if (leadSection) {
      leadSection.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });
    }

    if (leadPhone) {
      leadPhone.focus({ preventScroll: true });
    }
  });

  calculateEstimate();
}

function initLeadForm() {
  const form = document.querySelector("#lead");

  if (!form) {
    return;
  }

  const leadName = form.querySelector("#lead-name");
  const leadPhone = form.querySelector("#lead-phone");
  const leadComment = form.querySelector("#lead-comment");
  const leadConsent = form.querySelector("#lead-consent");
  const leadEstimate = form.querySelector("#lead-estimate");
  const formStatus = form.querySelector("#form-status");
  const submitButton = form.querySelector('button[type="submit"]');

  if (!leadName || !leadPhone || !leadConsent || !formStatus) {
    return;
  }

  leadPhone.addEventListener("input", () => {
    leadPhone.value = formatPhone(leadPhone.value);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFormStatus(formStatus, "", null);

    const isNameValid = leadName.value.trim().length >= 2;
    const isPhoneValid = validatePhone(leadPhone.value);

    if (!isNameValid) {
      setFormStatus(formStatus, "Введите имя, минимум 2 символа.", "error");
      leadName.focus();
      return;
    }

    if (!isPhoneValid) {
      setFormStatus(
        formStatus,
        "Проверьте номер телефона: нужен российский номер из 11 цифр.",
        "error",
      );
      leadPhone.focus();
      return;
    }

    if (!leadConsent.checked) {
      setFormStatus(
        formStatus,
        "Подтвердите согласие на обработку персональных данных.",
        "error",
      );
      leadConsent.focus();
      return;
    }

    const payload = {
      name: leadName.value.trim(),
      phone: leadPhone.value.trim(),
      comment: leadComment?.value.trim() || "",
      estimate: leadEstimate?.value || "",
      privacyConsent: leadConsent.checked,
      source: "Форма бесплатного замера",
      page: window.location.href,
    };

    setFormStatus(formStatus, "Отправляем заявку...", null);

    if (submitButton) {
      submitButton.disabled = true;
    }

    try {
      const response = await fetch("/api/lead", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.ok) {
        console.error("Lead form submission failed", {
          status: response.status,
          error: result.error || "unknown_error",
        });
        setFormStatus(
          formStatus,
          getLeadFormErrorMessage(result.error),
          "error",
        );
        return;
      }

      setFormStatus(
        formStatus,
        "Заявка отправлена. Мы скоро свяжемся с вами.",
        "success",
      );
      form.reset();
      document
        .querySelector("#price-form")
        ?.dispatchEvent(new Event("input", { bubbles: true }));
    } catch (error) {
      console.error("Lead form request failed", error);
      setFormStatus(formStatus, leadFormGenericError, "error");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  });
}

initYear();
initCalculator();
initLeadForm();
