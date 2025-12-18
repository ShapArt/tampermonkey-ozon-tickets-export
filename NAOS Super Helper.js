// ==UserScript==
// @name         NAOS Super Helper (Blog + Banners + Promos)
// @namespace    https://naos.ru/
// @version      2.0.0
// @description  Единый помощник для Журнала \"О коже\", Баннеров и Акций в Magento admin NAOS
// @author       Тёма
// @match        https://backend.naos.ru/*
// @run-at       document-end
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  "use strict";

  /**
   * Changelog:
   * 2.0.0 (2025-12-18): прод-рефакторинг, DEBUG-флаг, защита повторной инъекции,
   * гайд + модалка, перетаскиваемая панель с сохранением позиции, самопроверка страницы,
   * более стабильные парсеры ТЗ (Журнал/Баннер/Акция), улучшенные логи и безопасные попытки заполнения.
   */

  if (window.__NAOS_SUPER_HELPER_LOADED__) return;
  window.__NAOS_SUPER_HELPER_LOADED__ = true;

  const DEBUG = false; // единый флаг для подробных логов в консоль

  /******************************************************************
   * Namespace
   ******************************************************************/
  const SH = {
    version: "2.0.0",
    author: "NAOS DX team",
    Core: {},
    Modules: {},
  };
  const Core = SH.Core;
  Core.DEBUG = DEBUG;

  /******************************************************************
   * Core: utils
   ******************************************************************/
  Core.normalizeText = function (str) {
    return (str || "")
      .toString()
      .replace(/\u00A0/g, " ") // nbsp
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  };

  Core.slugifyRu = function (str) {
    if (!str) return "";
    let s = str.toString().toLowerCase().trim();
    const map = {
      а: "a",
      б: "b",
      в: "v",
      г: "g",
      д: "d",
      е: "e",
      ё: "e",
      ж: "zh",
      з: "z",
      и: "i",
      й: "y",
      к: "k",
      л: "l",
      м: "m",
      н: "n",
      о: "o",
      п: "p",
      р: "r",
      с: "s",
      т: "t",
      у: "u",
      ф: "f",
      х: "h",
      ц: "c",
      ч: "ch",
      ш: "sh",
      щ: "sch",
      ъ: "",
      ы: "y",
      ь: "",
      э: "e",
      ю: "yu",
      я: "ya",
    };
    s = s.replace(/[а-яё]/g, (ch) => map[ch] || "");
    s = s.replace(/[^a-z0-9]+/g, "-");
    s = s.replace(/-+/g, "-").replace(/^-|-$/g, "");
    return s || "post";
  };

  Core.escapeHtml = function (str) {
    return (str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  Core.strongify = function (str) {
    if (!str) return "";
    const brands = [
      "BIODERMA",
      "Institut Esthederm",
      "Etat Pur",
      "Better Minds",
      "100RM",
      "Pure",
    ];
    const gammas = [
      "ATODERM",
      "SEBIUM",
      "HYDRABIO",
      "EXCELLAGE",
      "EXCELLAGE NT",
      "INTENSIVE",
      "INTENSIVE PRO-COLLAGEN+",
      "PRO-COLLAGEN",
      "INTENSIVE HYALURONIC+",
      "SUNCARE",
      "PHOTO REVERSE",
      "INTO REPAIR",
      "BODY",
      "АТОДЕРМ",
      "СЕБИУМ",
      "ГИДРАБИО",
      "ЭКСЦЕЛЛАЖ",
      "ЭКСЕЛЛАЖ",
      "ЭКСЦЕЛЬЯЖ",
      "ИНТЕНСИВ",
      "ПРО-КОЛЛАГЕН",
      "ГИАЛУРОНИК",
    ];
    const monthPattern =
      "(январ[ья]|феврал[ья]|март[а]?|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|август[ае]?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])";
    const escapeRe = (v) =>
      v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    let res = str;
    // жирные проценты
    res = res.replace(/([+-]?\d{1,2}\s?%)/g, "<strong>$1</strong>");
    // жирные даты (01.12.2025 или с 1 по 31 декабря)
    res = res.replace(/(\d{1,2}\.\d{1,2}\.\d{2,4})/g, "<strong>$1</strong>");
    res = res.replace(
      new RegExp(
        `(с\\s*)?(\\d{1,2})\\s*(?:по|до|[-–—])\\s*(\\d{1,2})\\s+${monthPattern}`,
        "gi",
      ),
      (m) => `<strong>${m}</strong>`,
    );
    res = res.replace(
      new RegExp(`(\\d{1,2})\\s+${monthPattern}`, "gi"),
      (m) => `<strong>${m}</strong>`,
    );
    // жирные бренды/гаммы/месяцы
    [...brands, ...gammas].forEach((b) => {
      const re = new RegExp(escapeRe(b), "gi");
      res = res.replace(re, (m) => `<strong>${m}</strong>`);
    });
    res = res.replace(
      new RegExp(`\\b${monthPattern}\\b`, "gi"),
      (m) => `<strong>${m}</strong>`,
    );
    return res;
  };

  Core.todayYMD = function () {
    const d = new Date();
    const pad = (n) => (n < 10 ? "0" + n : "" + n);
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  };

  Core.wrapTextStyled = function (html) {
    if (!html) return "";
    return `<div style="font-family:'Open Sans', sans-serif; font-size:14px; line-height:1.6;">${html}</div>`;
  };

  /******************************************************************
   * Core: Log
   ******************************************************************/
  Core.Log = (function () {
    const entries = [];
    const MAX = 500;

    function push(area, level, msg, data) {
      const time = new Date().toLocaleTimeString("ru-RU", { hour12: false });
      const record = { time, area, level, msg, data };
      entries.push(record);
      if (entries.length > MAX) entries.shift();
      // В консоль выводим только в DEBUG или при ошибке, без чувствительных данных
      const tag = `[${time}][${area}][${level}]`;
      if (DEBUG || level === "ERROR") {
        try {
          // Не выводим объёмные объекты, только краткую строку
          const safeMsg = typeof msg === "string" ? msg : JSON.stringify(msg);
          console[
            level === "ERROR" ? "error" : level === "WARN" ? "warn" : "log"
          ](tag, safeMsg);
        } catch (_) {
          /* noop */
        }
      }
      if (Core.UI && Core.UI.renderLog) Core.UI.renderLog();
    }

    return {
      info(area, msg, data) {
        push(area, "INFO", msg, data);
      },
      warn(area, msg, data) {
        push(area, "WARN", msg, data);
      },
      error(area, msg, data) {
        push(area, "ERROR", msg, data);
      },
      getAll() {
        return entries.slice();
      },
      clear() {
        entries.length = 0;
        if (Core.UI && Core.UI.renderLog) Core.UI.renderLog();
      },
    };
  })();

  /******************************************************************
   * Core: Toast
   ******************************************************************/
  Core.Toast = (function () {
    let container = null;

    function ensureContainer() {
      if (container) return container;
      container = document.createElement("div");
      container.id = "nh-toast-container";
      container.style.position = "fixed";
      container.style.zIndex = "99999";
      container.style.right = "20px";
      container.style.bottom = "20px";
      container.style.display = "flex";
      container.style.flexDirection = "column";
      container.style.gap = "8px";
      document.body.appendChild(container);
      return container;
    }

    function show(message, type = "info", timeout = 4000) {
      const cont = ensureContainer();
      const el = document.createElement("div");
      el.className = `nh-toast nh-toast-${type}`;
      el.textContent = message;
      el.style.minWidth = "200px";
      el.style.maxWidth = "320px";
      el.style.background =
        type === "error" ? "#ff4d4f" : type === "warn" ? "#faad14" : "#1890ff";
      el.style.color = "#fff";
      el.style.padding = "8px 12px";
      el.style.borderRadius = "6px";
      el.style.boxShadow = "0 4px 12px rgba(0,0,0,0.25)";
      el.style.fontSize = "12px";
      el.style.fontFamily =
        'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
      cont.appendChild(el);
      setTimeout(() => {
        el.style.opacity = "0";
        el.style.transition = "opacity 0.2s ease-out";
        setTimeout(() => el.remove(), 250);
      }, timeout);
    }

    return { show };
  })();

  /******************************************************************
   * Core: DOM helpers
   ******************************************************************/
  Core.Dom = (function () {
    function findFieldByLabel(labelText) {
      const target = Core.normalizeText(labelText);
      const labels = document.querySelectorAll(
        ".admin__field-label label, .admin__field-label span, .admin__field-label",
      );
      for (const label of labels) {
        const txt = Core.normalizeText(label.textContent || "");
        if (!txt) continue;
        if (txt === target) {
          const field = label.closest(".admin__field, .field");
          if (field) return field;
        }
      }
      return null;
    }

    function dispatchChange(el) {
      if (!el) return;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function fillInputByLabel(labelText, value) {
      const field = findFieldByLabel(labelText);
      if (!field) {
        Core.Log.warn("DOM", `Не найдено поле input для "${labelText}"`);
        return false;
      }
      const input = field.querySelector(
        'input[type="text"], input[type="search"], input:not([type])',
      );
      if (!input) {
        Core.Log.warn("DOM", `В поле "${labelText}" нет input`);
        return false;
      }
      input.value = value != null ? String(value) : "";
      dispatchChange(input);
      Core.Log.info(
        "DOM",
        `Заполнен input "${labelText}" значением "${value}"`,
      );
      return true;
    }

    function fillTextareaByLabel(labelText, value) {
      const field = findFieldByLabel(labelText);
      if (!field) {
        Core.Log.warn("DOM", `Не найдено textarea для "${labelText}"`);
        return false;
      }
      const ta = field.querySelector("textarea");
      if (!ta) {
        Core.Log.warn("DOM", `В поле "${labelText}" нет textarea`);
        return false;
      }
      ta.value = value || "";
      dispatchChange(ta);
      Core.Log.info(
        "DOM",
        `Заполнена textarea "${labelText}" (${(value || "").length} символов)`,
      );
      return true;
    }

    function fillSelectByLabel(labelText, value) {
      const field = findFieldByLabel(labelText);
      if (!field) {
        Core.Log.warn("DOM", `Не найден select для "${labelText}"`);
        return false;
      }
      const select = field.querySelector("select");
      if (!select) {
        Core.Log.warn("DOM", `В поле "${labelText}" нет select`);
        return false;
      }
      const normTarget = Core.normalizeText(value);
      let matched = false;
      for (const opt of select.options) {
        const norm = Core.normalizeText(opt.textContent || "");
        if (!norm) continue;
        if (norm === normTarget) {
          select.value = opt.value;
          matched = true;
          break;
        }
      }
      if (!matched) {
        Core.Log.warn(
          "DOM",
          `Не найдено option "${value}" в select "${labelText}"`,
        );
        return false;
      }
      dispatchChange(select);
      Core.Log.info("DOM", `Выбрано "${value}" в select "${labelText}"`);
      return true;
    }

    function fillWysiwygByLabel(labelText, html) {
      const field = findFieldByLabel(labelText);
      if (!field) {
        Core.Log.warn("DOM", `Не найден WYSIWYG для "${labelText}"`);
        return false;
      }
      const ta = field.querySelector("textarea");
      if (!ta) {
        Core.Log.warn("DOM", `В поле "${labelText}" нет textarea (WYSIWYG)`);
        return false;
      }
      ta.value = html || "";
      dispatchChange(ta);
      try {
        if (window.tinyMCE && window.tinyMCE.get(ta.id)) {
          window.tinyMCE.get(ta.id).setContent(html || "");
        }
      } catch (e) {
        Core.Log.warn(
          "DOM",
          `Ошибка при работе с tinyMCE для "${labelText}"`,
          e,
        );
      }
      Core.Log.info(
        "DOM",
        `Заполнен WYSIWYG "${labelText}" (${(html || "").length} символов)`,
      );
      return true;
    }

    /**
     * Magento UI multiselect (Автор / Темы / Категории / Метки).
     * values: массив строк-лейблов, как в списке.
     */
    function selectFromUiMultiselect(labelText, values) {
      values = (values || [])
        .map((v) => v && v.toString().trim())
        .filter(Boolean);
      if (!values.length) {
        Core.Log.info(
          "DOM",
          `Для "${labelText}" пустой список значений — пропускаю`,
        );
        return false;
      }

      const field = findFieldByLabel(labelText);
      if (!field) {
        Core.Log.warn("DOM", `Не найдено поле multiselect для "${labelText}"`);
        return false;
      }

      const wrap = field.querySelector(".admin__action-multiselect-wrap");
      const trigger = wrap
        ? wrap.querySelector(".admin__action-multiselect")
        : null;
      if (!wrap || !trigger) {
        Core.Log.warn("DOM", `У поля "${labelText}" не найден UI multiselect`);
        return false;
      }

      const targetNorms = values.map((v) => Core.normalizeText(v));
      if (!wrap.classList.contains("_active")) trigger.click();

      const menu = wrap.querySelector(".admin__action-multiselect-menu-inner");
      if (!menu) {
        Core.Log.warn(
          "DOM",
          `Для "${labelText}" не найден список опций multiselect`,
        );
        return false;
      }

      const items = Array.from(
        menu.querySelectorAll(".admin__action-multiselect-menu-inner-item"),
      );
      if (!items.length) {
        Core.Log.warn("DOM", `У "${labelText}" нет доступных опций`);
        return false;
      }

      const matchedLabels = [];

      targetNorms.forEach((targetNorm) => {
        for (const li of items) {
          const span =
            li.querySelector(".admin__action-multiselect-label span") ||
            li.querySelector(".admin__action-multiselect-label") ||
            li.querySelector("span");
          if (!span) continue;
          const textNorm = Core.normalizeText(span.textContent || "");
          if (
            textNorm &&
            (textNorm === targetNorm ||
              textNorm.includes(targetNorm) ||
              targetNorm.includes(textNorm))
          ) {
            const labelNode = li.querySelector("label") || span;
            if (labelNode) labelNode.click();
            matchedLabels.push(span.textContent.trim());
            break;
          }
        }
      });

      const closeBtn = wrap.querySelector(
        '[data-action="close-advanced-select"]',
      );
      if (closeBtn) closeBtn.click();
      else trigger.click();

      if (!matchedLabels.length) {
        Core.Log.warn(
          "DOM",
          `Для "${labelText}" не найдено ни одного совпадения`,
          { values },
        );
        return false;
      }
      Core.Log.info(
        "DOM",
        `В multiselect "${labelText}" выбраны: ${matchedLabels.join(", ")}`,
      );
      return true;
    }

    /**
     * Переключатель (switch) Да/Нет по лейблу.
     */
    function setSwitchByLabel(labelText, checked) {
      const field = findFieldByLabel(labelText);
      if (!field) {
        Core.Log.warn("DOM", `Не найден switch для "${labelText}"`);
        return false;
      }
      const input = field.querySelector(".admin__actions-switch-checkbox");
      if (!input) {
        Core.Log.warn("DOM", `В поле "${labelText}" нет switch-checkbox`);
        return false;
      }
      const desired = !!checked;
      if (input.checked !== desired) {
        const label =
          field.querySelector(".admin__actions-switch-label") || input;
        label.click();
      }
      Core.Log.info(
        "DOM",
        `Switch "${labelText}" => ${desired ? "Да" : "Нет"}`,
      );
      return true;
    }

    return {
      findFieldByLabel,
      dispatchChange,
      fillInputByLabel,
      fillTextareaByLabel,
      fillSelectByLabel,
      fillWysiwygByLabel,
      selectFromUiMultiselect,
      setSwitchByLabel,
    };
  })();

  /******************************************************************
   * Core: Router
   ******************************************************************/
  Core.Router = (function () {
    function getContext() {
      const href = window.location.href;
      if (
        href.includes("/mageplaza_blog/post/edit") ||
        href.includes("/mageplaza_blog/post/new")
      ) {
        return "blog_edit";
      }
      if (href.includes("/oggetto_banner/entity/edit")) {
        return "banner_edit";
      }
      if (href.includes("/oggetto_banner/entity/index")) {
        return "banner_grid";
      }
      if (
        href.includes("/pharmacy/promotion/edit") ||
        href.includes("/pharmacy/promotion/new")
      ) {
        return "promo_edit";
      }
      return "unknown";
    }

    return { getContext };
  })();

  /******************************************************************
   * Core: Self-check (определяем текущую страницу)
   ******************************************************************/
  Core.SelfCheck = (function () {
    function summarize() {
      const ctx = Core.Router.getContext();
      const result = { ctx, ok: false, details: "" };
      if (ctx === "blog_edit") {
        result.ok = !!document.querySelector(
          'form[action*="mageplaza_blog/post"]',
        );
        result.details = result.ok
          ? "Журнал: форма найдена"
          : "Журнал: форма не найдена";
      } else if (ctx === "banner_edit" || ctx === "banner_grid") {
        result.ok =
          !!document.querySelector('form[action*="oggetto_banner"]') ||
          !!document.querySelector('[data-role="grid-wrapper"]');
        result.details = result.ok
          ? "Баннеры: страница найдена"
          : "Баннеры: форма не найдена";
      } else if (ctx === "promo_edit") {
        result.ok = !!document.querySelector(
          'form[action*="pharmacy/promotion"]',
        );
        result.details = result.ok
          ? "Акция: форма найдена"
          : "Акция: форма не найдена";
      } else {
        result.ok = false;
        result.details = "Страница не распознана";
      }
      return result;
    }

    function run() {
      const res = summarize();
      const msg = res.ok
        ? `Страница: ${res.details}`
        : `Неопознанная страница (${res.details})`;
      Core.Log[res.ok ? "info" : "warn"]("CHECK", msg);
      Core.Toast.show(msg, res.ok ? "info" : "warn");
      return res;
    }

    return { run };
  })();

  /******************************************************************
   * Core: State (localStorage)
   ******************************************************************/
  Core.State = (function () {
    const PREFIX = "NAOS_SH_";

    function getRaw(key) {
      try {
        return window.localStorage.getItem(PREFIX + key);
      } catch (e) {
        Core.Log.warn("STATE", "Ошибка чтения localStorage", e);
        return null;
      }
    }

    function setRaw(key, value) {
      try {
        if (value == null) window.localStorage.removeItem(PREFIX + key);
        else window.localStorage.setItem(PREFIX + key, String(value));
      } catch (e) {
        Core.Log.warn("STATE", "Ошибка записи localStorage", e);
      }
    }

    function getJson(key, fallback) {
      const raw = getRaw(key);
      if (!raw) return fallback;
      try {
        return JSON.parse(raw);
      } catch (e) {
        Core.Log.warn("STATE", `Ошибка JSON.parse для ключа ${key}`, e);
        return fallback;
      }
    }

    function setJson(key, obj) {
      setRaw(key, obj == null ? null : JSON.stringify(obj));
    }

    return {
      getRaw,
      setRaw,
      getJson,
      setJson,
    };
  })();

  /******************************************************************
   * Core: Config
   ******************************************************************/
  Core.Config = {
    Blog: {
      defaultType: "тест-редакции",
    },
    Banners: {
      defaultButtonText: "Подробнее",
      defaultShowAllLink: "/actions/",
      yellowColor: "#FFCC00",
    },
    Promos: {
      brandPriority: {
        BIODERMA: 1,
        "Institut Esthederm": 2,
        "Etat Pur": 3,
      },
      promoTypeKeywords: {
        discount: ["скидк", "%", "sale"],
        gift: ["подар", "free gift", "в подарок"],
        cashback: ["кешб", "cashback", "балл"],
        two_equal_one: ["2=1", "2 = 1", "2поцене1", "2 по цене 1", "2for1"],
        set: ["набор", "set"],
        n_plus_one: ["n+1", "n + 1", "3 по цене 2", "4=3"],
      },
      slugTemplate: "promo-{date}-{slug}",
      defaultDisclaimers: {
        short: "Количество товара ограничено. Подробности у оператора.",
        full: "Количество товара ограничено. Скидки и подарки не суммируются с другими предложениями. Действует до окончания товара.",
      },
      skuMap: {
        // BIODERMA / Sensibio
        "28727A": "28727G",
        "28726B": "28727G",
        "28712A": "28727G",
        "28727G": "28727G",
        // Sensibio H2O micellar
        "28704X": "28709AG",
        "28703X": "28709AG",
        "28709X": "28709AG",
        "28709W": "28709AG",
        "28709AG": "28709AG",
        // Sebium H2O
        "28632X": "28642XG",
        "28641X": "28642XG",
        "28642X": "28642XG",
        "28642W": "28642XG",
        "28642XG": "28642XG",
        // Sebium gel
        "28666A": "28664IG",
        "28663A": "28664IG",
        "28665A": "28664IG",
        "28664A": "28664IG",
        "28664IG": "28664IG",
        // Hydrabio H2O
        "28364BG": "28364BG",
        // Atoderm shower oil
        "28138C": "28134G",
        "28135A": "28134G",
        "28136A": "28134G",
        "28134G": "28134G",
        // Atoderm gel douche
        "28121A": "28119BG",
        "28126A": "28119BG",
        "28119BG": "28119BG",
        // Atoderm Intensive baume
        "28115A": "28103BG",
        "28104A": "28103BG",
        "28103A": "28103BG",
        "28103BG": "28103BG",
        // Atoderm stick
        "28051A": "28051AG",
        "28067A": "28051AG",
        "28065C": "28051AG",
        "28051AG": "28051AG",
        // Atoderm Intensive eye
        "28147G": "28147G",
        // Atoderm shower gel parfum free
        "28133G": "28133G",
      },
    },
  };

  /******************************************************************
   * Core: UI (панель)
   ******************************************************************/
  const GUIDE_TEXT = `NAOS Super Helper — быстрый гайд
1) Установи Tampermonkey и скрипт NAOS Super Helper (.user.js).
2) Открой нужную страницу в Magento admin (Журнал / Баннер / Акция) — панель появится.
3) Выбери вкладку, вставь ТЗ, нажми "Разобрать ТЗ", посмотри лог/превью, затем "Заполнить форму".
4) Панель можно перетащить за хедер, позиция сохранится; кнопку "Сброс позиции" жми если уехала.
5) Лог в панели — без секретов; для подробных логов включи DEBUG в коде.
6) Кнопка "Проверить страницу" показывает, с какой формой мы работаем.

Примеры ТЗ (копируй как есть)
--- Акция/Промо (пример 1)
Заголовок: Подарок Etat Pur
Период: 11.12.2025 – 31.12.2025
Бренд: Etat Pur
Условия: Подарок за покупку
Текст: …
SKU:
55555
66666
Дисклеймер: …
URL: https://naos.ru/actions/
Текст рядом с кружком: …

--- Акция/Промо (пример 2)
Период: 01.12.2025 – 31.12.2025
Заголовок: -20% на наборы Bioderma
Подзаголовок: Только онлайн. Количество ограничено.
Дисклеймер:
АКЦИЯ
Скидка действует на наборы при покупке на сайте naos.ru.
Не суммируется с другими предложениями.
Кнопка: В каталог
URL кнопки: https://naos.ru/catalog/packs/

--- Журнал (пример по шаблону)
Название материала
Идеи новогодних подарков: косметика и уход для всех типов кожи
Тип материала
Подборка
Автор
Хан Юлия
Краткое описание
Короткое интро 2–4 предложения…
Категории
Уход, Лицо, Тело
Темы
Зима, Подарки
Время на чтение
6 минут
Основной текст статьи
Текст блока 1…
Рекомендация по верстке: Блок 1 / под товары
SKU12345, SKU67890
Текст блока 2…
Рекомендация по верстке: Блок 2 / продолжение
SKU11111;SKU22222

--- Баннер (ключ: значение)
Заголовок: -20% на наборы Bioderma
Подзаголовок: Только онлайн. Количество ограничено.
Период: 01.12.2025 – 31.12.2025
Бренд: Bioderma
Место: Главная, бренд-зоны
Кнопка: В каталог
URL: https://naos.ru/catalog/packs/
Дисклеймер: АКЦИЯ
Alt: Баннер -20% Bioderma`;
  Core.UI = (function () {
    let root;
    let logContainer;
    let guideOverlay;
    let dragState = null;

    const POSITION_KEY = "PANEL_POSITION_V2";
    const TAB_KEY = "PANEL_LAST_TAB_V1";

    function injectStyles() {
      if (document.getElementById("nh-style")) return;
      const s = document.createElement("style");
      s.id = "nh-style";
      s.textContent = `
      #nh-root {
        position: fixed;
        top: 80px;
        right: auto;
        left: auto;
        width: 420px;
        max-height: calc(100vh - 96px);
        z-index: 99998;
        font-family: system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        font-size: 12px;
        color: #111827;
        background: rgba(17,24,39,0.98);
        border-radius: 12px;
        box-shadow: 0 18px 40px rgba(0,0,0,0.35);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,0.08);
      }
      #nh-root.nh-collapsed {
        height: auto;
        max-height: none;
      }
      .nh-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 10px;
        background: linear-gradient(135deg,#111827,#1f2937);
        border-bottom: 1px solid rgba(255,255,255,0.06);
        cursor: grab;
        user-select: none;
      }
      .nh-header.nh-dragging { cursor: grabbing; }
      .nh-title { font-size: 12px; font-weight: 600; color: #e5e7eb; }
      .nh-version { font-size: 11px; color: #9ca3af; margin-left: 4px; }
      .nh-author { font-size: 11px; color: #60a5fa; margin-left: 6px; opacity: 0.9; }
      .nh-header-left { display: flex; align-items: baseline; gap: 4px; }
      .nh-header-actions { display: flex; gap: 6px; align-items: center; }
      .nh-action-btn {
        border: 1px solid rgba(75,85,99,0.9);
        background: rgba(31,41,55,0.9);
        color: #e5e7eb;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 8px;
        font-size: 11px;
      }
      .nh-action-btn:hover { background: rgba(55,65,81,0.95); }
      .nh-body { display: flex; flex-direction: column; background: #111827; }
      .nh-tabs { display: flex; border-bottom: 1px solid rgba(55,65,81,1); }
      .nh-tab {
        flex: 1;
        padding: 6px 0;
        border: none;
        background: transparent;
        color: #9ca3af;
        font-size: 11px;
        cursor: pointer;
      }
      .nh-tab-active { color: #f9fafb; background: radial-gradient(circle at top,rgba(59,130,246,0.35),transparent); }
      .nh-tab-panels { padding: 8px 10px 10px; overflow: auto; position: relative; }
      .nh-tab-panel { display: none; }
      .nh-tab-panel-active { display: block; }
      .nh-section-title { font-size: 11px; font-weight: 600; color: #e5e7eb; margin-bottom: 4px; }
      .nh-textarea {
        width: 100%;
        min-height: 90px;
        max-height: 180px;
        resize: vertical;
        border-radius: 8px;
        border: 1px solid rgba(55,65,81,1);
        background: rgba(17,24,39,0.95);
        color: #e5e7eb;
        padding: 6px 8px;
        box-sizing: border-box;
        font-size: 12px;
      }
      .nh-input {
        width: 100%;
        border-radius: 8px;
        border: 1px solid rgba(55,65,81,1);
        background: rgba(17,24,39,0.95);
        color: #e5e7eb;
        padding: 4px 6px;
        font-size: 12px;
        box-sizing: border-box;
      }
      .nh-row { display: flex; gap: 6px; margin-top: 6px; align-items: center; flex-wrap: wrap; }
      .nh-row label { color: #d1d5db; font-size: 11px; }
      .nh-btn {
        border: none;
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        background: linear-gradient(135deg,#2563eb,#3b82f6);
        color: white;
        box-shadow: 0 8px 20px rgba(37,99,235,0.25);
      }
      .nh-btn-secondary { background: rgba(31,41,55,1); color: #e5e7eb; }
      .nh-btn:hover { filter: brightness(1.05); }
      .nh-preview {
        margin-top: 6px;
        padding: 6px 8px;
        border-radius: 8px;
        border: 1px solid rgba(55,65,81,1);
        background: rgba(15,23,42,0.9);
        color: #d1d5db;
        font-size: 11px;
        max-height: 140px;
        overflow: auto;
      }
      .nh-log-list {
        font-size: 12px;
        line-height: 1.5;
        max-height: 240px;
        overflow: auto;
        padding: 6px 8px;
        margin-top: 6px;
        border-radius: 8px;
        border: 1px solid rgba(55,65,81,1);
        background: rgba(15,23,42,0.95);
        color: #e5e7eb;
        box-sizing: border-box;
      }
      .nh-log-item { padding: 3px 0; border-bottom: 1px dashed rgba(75,85,99,0.9); }
      .nh-log-item:last-child { border-bottom: none; }
      .nh-log-item:hover { background: rgba(31,41,55,0.85); }
      .nh-log-time { color: #9ca3af; font-variant-numeric: tabular-nums; margin-right: 4px; }
      .nh-log-area { color: #93c5fd; margin-right: 4px; }
      .nh-log-level-INFO { color: #a5b4fc; font-weight: 500; margin-right: 4px; }
      .nh-log-level-WARN { color: #fbbf24; font-weight: 600; margin-right: 4px; }
      .nh-log-level-ERROR { color: #fecaca; font-weight: 700; margin-right: 4px; }
      .nh-log-message { color: #e5e7eb; }
      .nh-guide-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0,0,0,0.78);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 12px;
        z-index: 10;
      }
      .nh-guide-overlay.active { display: flex; }
      .nh-guide-card {
        background: #0f172a;
        border: 1px solid rgba(148,163,184,0.35);
        border-radius: 12px;
        padding: 12px;
        max-height: calc(100vh - 140px);
        max-width: 820px;
        width: 100%;
        overflow: auto;
        color: #e5e7eb;
        box-shadow: 0 16px 40px rgba(0,0,0,0.35);
      }
      .nh-guide-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
      .nh-guide-title { font-size: 14px; font-weight: 700; }
      .nh-guide-close { cursor: pointer; background: transparent; border: 1px solid rgba(148,163,184,0.4); color: #e5e7eb; border-radius: 8px; padding: 4px 8px; }
      .nh-guide-close:hover { background: rgba(255,255,255,0.06); }
      .nh-guide-body { white-space: pre-wrap; font-family: "SFMono-Regular",Consolas,Menlo,monospace; font-size: 12px; line-height: 1.5; }
      .nh-noselect { user-select: none !important; }
      `;
      document.head.appendChild(s);
    }

    function clampPosition(pos) {
      if (!root) return pos;
      const rect = root.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const clamped = { ...pos };
      const maxLeft = Math.max(0, vw - rect.width - 8);
      const maxTop = Math.max(0, vh - rect.height - 8);
      clamped.left = Math.min(Math.max(8, pos.left), maxLeft);
      clamped.top = Math.min(Math.max(8, pos.top), maxTop);
      return clamped;
    }

    function applyPosition(pos) {
      if (!root || !pos) return;
      root.style.top = `${pos.top}px`;
      root.style.left = `${pos.left}px`;
      root.style.right = "auto";
    }

    function savePosition(pos) {
      Core.State.setJson(POSITION_KEY, pos);
    }

    function getDefaultPosition() {
      const top = 80;
      const rect = root.getBoundingClientRect();
      const left = Math.max(12, window.innerWidth - rect.width - 20);
      return clampPosition({ top, left });
    }

    function initPosition() {
      const stored = Core.State.getJson(POSITION_KEY, null);
      const pos = clampPosition(stored || getDefaultPosition());
      applyPosition(pos);
      savePosition(pos);
    }

    function startDrag(e) {
      if (!root || e.button !== 0) return;
      const rect = root.getBoundingClientRect();
      dragState = {
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
      };
      document.body.classList.add("nh-noselect");
      const header = root.querySelector(".nh-header");
      if (header) header.classList.add("nh-dragging");
      document.addEventListener("mousemove", onDrag);
      document.addEventListener("mouseup", stopDrag);
    }

    function onDrag(e) {
      if (!dragState) return;
      const next = clampPosition({
        left: e.clientX - dragState.offsetX,
        top: e.clientY - dragState.offsetY,
      });
      applyPosition(next);
    }

    function stopDrag() {
      if (!dragState) return;
      const rect = root.getBoundingClientRect();
      const pos = clampPosition({ top: rect.top, left: rect.left });
      applyPosition(pos);
      savePosition(pos);
      dragState = null;
      document.body.classList.remove("nh-noselect");
      const header = root.querySelector(".nh-header");
      if (header) header.classList.remove("nh-dragging");
      document.removeEventListener("mousemove", onDrag);
      document.removeEventListener("mouseup", stopDrag);
    }

    function bindActions() {
      const clearBtn = document.getElementById("nh-log-clear");
      if (clearBtn) clearBtn.addEventListener("click", () => Core.Log.clear());

      const blogParseBtn = document.getElementById("nh-blog-parse");
      if (blogParseBtn)
        blogParseBtn.addEventListener("click", () =>
          SH.Modules.Blog?.handleParseClick?.(),
        );
      const blogFillBtn = document.getElementById("nh-blog-fill");
      if (blogFillBtn)
        blogFillBtn.addEventListener("click", () =>
          SH.Modules.Blog?.handleFillClick?.(),
        );

      const bannersParseBtn = document.getElementById("nh-banners-parse");
      if (bannersParseBtn)
        bannersParseBtn.addEventListener("click", () =>
          SH.Modules.Banners?.handleParseClick?.(),
        );
      const bannersFillBtn = document.getElementById("nh-banners-fill");
      if (bannersFillBtn)
        bannersFillBtn.addEventListener("click", () =>
          SH.Modules.Banners?.handleFillClick?.(),
        );

      const promosParseBtn = document.getElementById("nh-promos-parse");
      if (promosParseBtn)
        promosParseBtn.addEventListener("click", () =>
          SH.Modules.Promos?.handleParseClick?.(),
        );
      const promosFillBtn = document.getElementById("nh-promos-fill");
      if (promosFillBtn)
        promosFillBtn.addEventListener("click", () =>
          SH.Modules.Promos?.handleFillClick?.(),
        );
      const promosQueueAddBtn = document.getElementById("nh-promos-queue-add");
      if (promosQueueAddBtn)
        promosQueueAddBtn.addEventListener("click", () =>
          SH.Modules.Promos?.handleQueueAdd?.(),
        );
      const promosNextBtn = document.getElementById("nh-promos-next");
      if (promosNextBtn)
        promosNextBtn.addEventListener("click", () =>
          SH.Modules.Promos?.handleQueueNext?.(),
        );
      const promosClearBtn = document.getElementById("nh-promos-clear");
      if (promosClearBtn)
        promosClearBtn.addEventListener("click", () =>
          SH.Modules.Promos?.handleQueueClear?.(),
        );
      const promosAutopilot = document.getElementById("nh-promos-autopilot");
      if (promosAutopilot)
        promosAutopilot.addEventListener("change", (e) => {
          SH.Modules.Promos?.handleAutopilotToggle?.(!!e.target.checked);
        });

      const guideBtn = root.querySelector("[data-nh-guide]");
      if (guideBtn) guideBtn.addEventListener("click", showGuide);
      const guideClose = root.querySelector("[data-nh-guide-close]");
      if (guideClose) guideClose.addEventListener("click", hideGuide);

      const checkBtn = root.querySelector("[data-nh-check]");
      if (checkBtn)
        checkBtn.addEventListener("click", () => {
          Core.SelfCheck && Core.SelfCheck.run && Core.SelfCheck.run();
        });

      const resetBtn = root.querySelector("[data-nh-reset]");
      if (resetBtn)
        resetBtn.addEventListener("click", () => {
          const pos = getDefaultPosition();
          applyPosition(pos);
          savePosition(pos);
          Core.Toast.show("Позиция панели сброшена", "info");
        });

      const collapseBtn = root.querySelector("[data-nh-collapse]");
      if (collapseBtn) collapseBtn.addEventListener("click", toggleCollapse);

      const header = root.querySelector(".nh-header");
      if (header) header.addEventListener("mousedown", startDrag);

      root.addEventListener("click", (e) => {
        const tabBtn = e.target.closest("[data-nh-tab]");
        if (tabBtn) {
          const tab = tabBtn.getAttribute("data-nh-tab");
          setActiveTab(tab);
        }
      });
    }

    function buildPanel() {
      injectStyles();
      if (document.getElementById("nh-root")) {
        root = document.getElementById("nh-root");
        logContainer = document.getElementById("nh-log");
        setActiveTab(Core.State.getJson(TAB_KEY, getTabForContext()));
        return;
      }

      root = document.createElement("div");
      root.id = "nh-root";
      root.innerHTML = `
        <div class="nh-header">
          <div class="nh-header-left">
            <span class="nh-title">NAOS Super Helper</span>
            <span class="nh-version">v${SH.version}</span>
            <span class="nh-author">${SH.author || "NAOS"}</span>
          </div>
          <div class="nh-header-actions">
            <button class="nh-action-btn" type="button" data-nh-check>Проверить страницу</button>
            <button class="nh-action-btn" type="button" data-nh-guide>Гайд</button>
            <button class="nh-action-btn" type="button" data-nh-reset>Сброс позиции</button>
            <button class="nh-action-btn" type="button" data-nh-collapse>Свернуть</button>
          </div>
        </div>
        <div class="nh-body">
          <div class="nh-tabs">
            <button class="nh-tab nh-tab-active" data-nh-tab="blog">Журнал</button>
            <button class="nh-tab" data-nh-tab="banners">Баннеры</button>
            <button class="nh-tab" data-nh-tab="promos">Акции</button>
            <button class="nh-tab" data-nh-tab="log">Лог</button>
          </div>
          <div class="nh-tab-panels">
            <div class="nh-tab-panel nh-tab-panel-active" id="nh-tab-blog">
              <div class="nh-section-title">Журнал (ТЗ из шаблона)</div>
              <textarea id="nh-blog-tz" class="nh-textarea" placeholder="Вставь сюда текст из файла"></textarea>
              <div class="nh-row">
                <button id="nh-blog-parse" class="nh-btn" type="button">Разобрать ТЗ</button>
                <button id="nh-blog-fill" class="nh-btn nh-btn-secondary" type="button">Заполнить форму журнала</button>
              </div>
              <div id="nh-blog-preview" class="nh-preview"></div>
            </div>
            <div class="nh-tab-panel" id="nh-tab-banners">
              <div class="nh-section-title">Баннеры (oggetto_banner)</div>
              <textarea id="nh-banners-tz" class="nh-textarea" placeholder="Формат: ключ: значение; допускаются блоки, ссылки, alt"></textarea>
              <div class="nh-row">
                <label><input type="checkbox" id="nh-banners-main" checked> Main / главная</label>
                <label><input type="checkbox" id="nh-banners-pdp" checked> PDP / карточки</label>
                <label><input type="checkbox" id="nh-banners-brands" checked> Брендзоны (все)</label>
              </div>
              <div class="nh-row" style="width:100%;">
                <label style="flex:1;">URL акции / раздела
                  <input id="nh-banners-url" class="nh-input" type="text" placeholder="https://naos.ru/actions/...">
                </label>
              </div>
              <div class="nh-row">
                <button id="nh-banners-parse" class="nh-btn" type="button">Разобрать ТЗ</button>
                <button id="nh-banners-fill" class="nh-btn nh-btn-secondary" type="button">Заполнить баннер</button>
              </div>
              <div id="nh-banners-preview" class="nh-preview"></div>
            </div>
            <div class="nh-tab-panel" id="nh-tab-promos">
              <div class="nh-section-title">Акции / Промо</div>
              <textarea id="nh-promos-tz" class="nh-textarea" placeholder="Вставь ТЗ акции (см. гайд)"></textarea>
              <div class="nh-row">
                <button id="nh-promos-parse" class="nh-btn" type="button">Разобрать ТЗ</button>
                <button id="nh-promos-fill" class="nh-btn nh-btn-secondary" type="button">Заполнить акцию</button>
                <button id="nh-promos-queue-add" class="nh-btn nh-btn-secondary" type="button">В очередь</button>
              </div>
              <div class="nh-row">
                <button id="nh-promos-next" class="nh-btn" type="button">Следующая из очереди</button>
                <button id="nh-promos-clear" class="nh-btn nh-btn-secondary" type="button">Очистить очередь</button>
                <label style="display:flex;align-items:center;gap:4px;"><input type="checkbox" id="nh-promos-autopilot"> автопилот</label>
              </div>
              <div id="nh-promos-preview" class="nh-preview"></div>
              <div id="nh-promos-queue" class="nh-preview"></div>
            </div>
            <div class="nh-tab-panel" id="nh-tab-log">
              <div class="nh-row" style="justify-content: space-between;">
                <div style="color:#9ca3af;font-size:11px;">Лог без чувствительных данных</div>
                <button id="nh-log-clear" class="nh-btn nh-btn-secondary" type="button">Очистить лог</button>
              </div>
              <div id="nh-log" class="nh-log-list"></div>
            </div>
            <div class="nh-guide-overlay" id="nh-guide">
              <div class="nh-guide-card">
                <div class="nh-guide-header">
                  <div class="nh-guide-title">Гайд по NAOS Super Helper</div>
                  <button class="nh-guide-close" type="button" data-nh-guide-close>Закрыть</button>
                </div>
                <div class="nh-guide-body">${Core.escapeHtml(GUIDE_TEXT)}</div>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(root);

      logContainer = document.getElementById("nh-log");
      guideOverlay = document.getElementById("nh-guide");

      root.classList.add("nh-collapsed");
      const body = root.querySelector(".nh-body");
      if (body) body.style.display = "none";

      initPosition();
      bindActions();
      setActiveTab(getTabForContext());
      window.addEventListener("resize", () => {
        const rect = root.getBoundingClientRect();
        const pos = clampPosition({ top: rect.top, left: rect.left });
        applyPosition(pos);
        savePosition(pos);
      });

      Core.Log.info("UI", "Панель Super Helper отрисована");
    }

    function getTabForContext() {
      const stored = Core.State.getJson(TAB_KEY, null);
      if (stored) return stored;
      const ctx = SH.Core.Router.getContext();
      if (ctx === "blog_edit") return "blog";
      if (ctx === "banner_edit" || ctx === "banner_grid") return "banners";
      if (ctx === "promo_edit") return "promos";
      return "blog";
    }

    function setActiveTab(tab) {
      if (!root) return;
      Core.State.setJson(TAB_KEY, tab);
      const tabs = root.querySelectorAll(".nh-tab");
      tabs.forEach((btn) =>
        btn.classList.toggle(
          "nh-tab-active",
          btn.getAttribute("data-nh-tab") === tab,
        ),
      );
      const panels = root.querySelectorAll(".nh-tab-panel");
      panels.forEach((p) =>
        p.classList.toggle("nh-tab-panel-active", p.id === `nh-tab-${tab}`),
      );
    }

    function toggleCollapse() {
      if (!root) return;
      root.classList.toggle("nh-collapsed");
      const body = root.querySelector(".nh-body");
      if (root.classList.contains("nh-collapsed")) {
        body.style.display = "none";
      } else {
        body.style.display = "flex";
      }
    }

    function renderLog() {
      if (!logContainer) return;
      const logs = Core.Log.getAll();
      logContainer.innerHTML = logs
        .map((rec) => {
          const lvlClass = `nh-log-level-${rec.level}`;
          const msg = Core.escapeHtml(rec.msg || "");
          return `<div class="nh-log-item">
          <span class="nh-log-time">${rec.time}</span>
          <span class="nh-log-area">[${rec.area}]</span>
          <span class="${lvlClass}">${rec.level}</span>
          <span class="nh-log-message">${msg}</span>
        </div>`;
        })
        .join("");
      logContainer.scrollTop = logContainer.scrollHeight;
    }

    function showGuide() {
      if (!guideOverlay) return;
      guideOverlay.classList.add("active");
    }

    function hideGuide() {
      if (!guideOverlay) return;
      guideOverlay.classList.remove("active");
    }

    function init() {
      buildPanel();
    }

    return { init, renderLog, showGuide };
  })();

  /******************************************************************
   * Module: Blog (Журнал "О коже")
   ******************************************************************/
  SH.Modules.Blog = (function () {
    const Dom = Core.Dom;
    const Log = Core.Log;
    const Toast = Core.Toast;
    const State = Core.State;

    const STATE_KEY = "BLOG_LAST_PARSED_V1";
    const BLOG_TYPE_DEFAULTS = ["Статья", "Новости", "Видео с экспертами"];

    function norm(s) {
      return Core.normalizeText(s);
    }

    function readTzText() {
      const el = document.getElementById("nh-blog-tz");
      return el ? el.value || "" : "";
    }

    function parseTz() {
      const raw = readTzText();
      const text = raw.replace(/\r/g, "").trim();
      if (!text) {
        Toast.show("ТЗ пустое", "warn");
        Log.warn("BLOG", "ТЗ пустое");
        return null;
      }

      const lines = text.split("\n").map((l) => l.trim());
      const LABELS = {
        title: "Название материала",
        type: "Тип материала",
        author: "Автор",
        short: "Краткое описание",
        categories: "Категории",
        topics: "Темы",
        readTime: "Время на чтение",
        seoTitle: "SEO-заголовок (опционально)",
        bodyStart: "Основной текст статьи",
      };

      const map = {
        title: [],
        type: [],
        author: [],
        short: [],
        categories: [],
        topics: [],
        readTime: [],
        seoTitle: [],
      };
      const bodyLines = [];

      let currentField = null;
      let inBody = false;
      let inSample = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const nl = norm(line);

        if (!inBody) {
          if (nl.startsWith("правила заполнения")) {
            inSample = true;
            continue;
          }
          if (nl === "пример структуры") {
            inSample = true;
            continue;
          }
        }
        if (inSample) continue;

        if (nl === norm(LABELS.bodyStart)) {
          inBody = true;
          currentField = "body";
          continue;
        }

        if (!inBody) {
          if (nl === norm(LABELS.title)) {
            currentField = "title";
            continue;
          }
          if (nl === norm(LABELS.type)) {
            currentField = "type";
            continue;
          }
          if (nl === norm(LABELS.author)) {
            currentField = "author";
            continue;
          }
          if (nl === norm(LABELS.short)) {
            currentField = "short";
            continue;
          }
          if (nl === norm(LABELS.categories)) {
            currentField = "categories";
            continue;
          }
          if (nl === norm(LABELS.topics)) {
            currentField = "topics";
            continue;
          }
          if (nl === norm(LABELS.readTime)) {
            currentField = "readTime";
            continue;
          }
          if (nl === norm("seo-заголовок") || nl === norm(LABELS.seoTitle)) {
            currentField = "seoTitle";
            continue;
          }

          if (currentField && map[currentField]) {
            map[currentField].push(line);
          }
        } else {
          bodyLines.push(line);
        }
      }

      const meta = {
        title: (map.title[0] || "").trim(),
        type: (map.type[0] || "").trim(),
        author: (map.author[0] || "").trim(),
        shortDescription: map.short.join(" ").trim(),
        categories: map.categories
          .join(" ")
          .split(/[,;]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        topics: map.topics
          .join(" ")
          .split(/[,;]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        readTime: (map.readTime[0] || "").trim(),
        seoTitle: (map.seoTitle[0] || "").trim(),
      };

      if (!meta.type) {
        const inferred = detectType(text);
        if (inferred) meta.type = inferred;
      }

      const blocks = parseBlocks(bodyLines);

      Log.info("BLOG", "Разобрано ТЗ статьи", {
        title: meta.title,
        author: meta.author,
        blocks: blocks.length,
      });

      return { meta, blocks };
    }

    function detectType(text) {
      const n = Core.normalizeText(text || "");
      if (!n) return "";
      if (n.includes("видео") || n.includes("video") || n.includes("эксперт"))
        return "Видео с экспертами";
      if (n.includes("новост")) return "Новости";
      return "Статья";
    }

    function parseBlocks(bodyLines) {
      const blocks = [];
      let currentText = [];
      let currentSkus = [];
      let expectingSku = false;

      function push() {
        const text = currentText.join("\n").trim();
        if (!text && !currentSkus.length) return;
        blocks.push({ text, skus: currentSkus.slice() });
        currentText = [];
        currentSkus = [];
      }

      for (let i = 0; i < bodyLines.length; i++) {
        const line = bodyLines[i].trim();
        if (!line) {
          currentText.push("");
          continue;
        }
        const nl = line.toLowerCase().replace(/\s+/g, " ");
        if (nl.startsWith("рекомендация по верстке")) {
          push();
          expectingSku = true;
          continue;
        }
        if (expectingSku) {
          expectingSku = false;
          const skuLine = line.replace(/\s/g, "");
          if (skuLine) {
            currentSkus = skuLine
              .split(/[,;]+/)
              .map((s) => s.trim())
              .filter(Boolean);
          }
          continue;
        }
        currentText.push(line);
      }
      push();
      return blocks;
    }

    function textToHtml(text) {
      const t = text.replace(/\r/g, "").trim();
      if (!t) return "";
      const paragraphs = t
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean);
      const html = [];
      paragraphs.forEach((p) => {
        const isHeading =
          p.length <= 120 && !/[.!?]/.test(p) && /[А-ЯЁA-Z]/.test(p.charAt(0));
        const safe = Core.escapeHtml(p).replace(/\n/g, "<br>");
        const content = Core.strongify(safe);
        if (isHeading) html.push(`<h2>${content}</h2>`);
        else html.push(`<p>${content}</p>`);
      });
      return Core.wrapTextStyled(html.join("\n"));
    }

    function buildPreview(parsed) {
      const el = document.getElementById("nh-blog-preview");
      if (!el) return;
      if (!parsed) {
        el.textContent = "ТЗ не разобрано.";
        return;
      }
      const { meta, blocks } = parsed;
      const lines = [];
      lines.push(`Название: ${meta.title || "—"}`);
      lines.push(`Тип: ${meta.type || "—"}`);
      lines.push(`Автор: ${meta.author || "—"}`);
      lines.push(`Краткое описание: ${meta.shortDescription || "—"}`);
      lines.push(`Категории: ${(meta.categories || []).join(", ") || "—"}`);
      lines.push(`Темы: ${(meta.topics || []).join(", ") || "—"}`);
      lines.push(`Время на чтение: ${meta.readTime || "—"}`);
      lines.push(`SEO-заголовок: ${meta.seoTitle || "—"}`);
      lines.push(`Блоков текста: ${blocks.length}`);
      el.textContent = lines.join("\n");
    }

    function applyToForm(parsed) {
      if (!parsed) return;
      const { meta, blocks } = parsed;

      const hasForm =
        !!document.querySelector("form#edit_form") ||
        !!document.querySelector('form[action*="mageplaza_blog/post"]');
      if (!hasForm) {
        Toast.show("Форма статьи блога не найдена", "error");
        Log.error("BLOG", "Форма блога не найдена");
        return;
      }

      // Название
      if (meta.title) {
        Dom.fillInputByLabel("Название", meta.title);
      }

      // Тип
      if (meta.type) {
        Dom.fillSelectByLabel("Тип", meta.type);
      } else {
        for (const t of BLOG_TYPE_DEFAULTS) {
          if (Dom.fillSelectByLabel("Тип", t)) break;
        }
        if (Core.Config.Blog.defaultType) {
          Dom.fillSelectByLabel("Тип", Core.Config.Blog.defaultType);
        }
      }

      // Автор
      if (meta.author) {
        Dom.selectFromUiMultiselect("Автор", [meta.author]);
      }

      // Краткое описание
      if (meta.shortDescription) {
        Dom.fillTextareaByLabel("Краткое описание", meta.shortDescription);
      }

      // Начальный текст = краткое описание
      if (meta.shortDescription) {
        Dom.fillWysiwygByLabel(
          "Начальный текст",
          Core.wrapTextStyled(
            `<p>${Core.strongify(Core.escapeHtml(meta.shortDescription))}</p>`,
          ),
        );
      }

      // Категории
      if (meta.categories && meta.categories.length) {
        Dom.selectFromUiMultiselect("Категории", meta.categories);
      }

      // Темы
      if (meta.topics && meta.topics.length) {
        Dom.selectFromUiMultiselect("Темы", meta.topics);
      }

      // Время на чтение
      if (meta.readTime) {
        Dom.fillInputByLabel("Время на чтение", meta.readTime);
      }

      // SEO заголовок
      if (meta.seoTitle) {
        Dom.fillInputByLabel("Заголовок Meta", meta.seoTitle);
      }

      // Дата публикации = сейчас
      try {
        const d = new Date();
        const pad = (n) => (n < 10 ? "0" + n : "" + n);
        const formatted = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
          d.getDate(),
        )} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        Dom.fillInputByLabel("Дата публикации", formatted);
      } catch (e) {
        Log.warn("BLOG", "Не смог поставить дату: " + e.message);
      }

      // Тексты 1..10 + артикулы
      if (blocks && blocks.length) {
        const max = Math.min(blocks.length, 10);
        for (let i = 0; i < max; i++) {
          const b = blocks[i];
          const idx = i + 1;
          const html = textToHtml(b.text);
          if (html) {
            Dom.fillWysiwygByLabel(`Текст ${idx}`, html);
          }
          if (b.skus && b.skus.length) {
            Dom.fillInputByLabel(
              `Артикулы продуктов текста ${idx}`,
              b.skus.join(","),
            );
          }
        }
      }

      Log.info("BLOG", "Форма блога заполнена по ТЗ", {
        title: meta.title,
        author: meta.author,
      });
      Toast.show("Журнал заполнен по ТЗ", "info");
    }

    function handleParseClick() {
      try {
        Log.info("BLOG", "Старт разбора ТЗ (v1)");
        const parsed = parseTz();
        if (!parsed) return;
        State.setJson(STATE_KEY, parsed);
        buildPreview(parsed);
        Toast.show("ТЗ разобрано, можно заполнять форму", "info");
      } catch (e) {
        Log.error("BLOG", "Ошибка при разборе ТЗ: " + e.message);
        Toast.show("Ошибка при разборе ТЗ, смотри лог", "error");
      }
    }

    function handleFillClick() {
      try {
        let parsed = State.getJson(STATE_KEY, null);
        if (!parsed) {
          Log.warn("BLOG", "Нет сохранённого результата разбора, парсю заново");
          parsed = parseTz();
        }
        if (!parsed) {
          Toast.show("Сначала нажми «Разобрать ТЗ»", "warn");
          return;
        }
        applyToForm(parsed);
      } catch (e) {
        Log.error("BLOG", "Ошибка при заполнении формы: " + e.message);
        Toast.show("Ошибка при заполнении формы, смотри лог", "error");
      }
    }

    function init() {
      const stored = State.getJson(STATE_KEY, null);
      if (stored) buildPreview(stored);
      Log.info("BLOG", "Blog-модуль инициализирован");
    }

    return {
      init,
      handleParseClick,
      handleFillClick,
    };
  })();

  /******************************************************************
   * Modules: Banners / Promo
   ******************************************************************/
  SH.Modules.Banners = (function () {
    const Log = Core.Log;
    const Toast = Core.Toast;
    const Dom = Core.Dom;
    const State = Core.State;

    const STATE_KEY = "BANNERS_LAST_PARSED_V1";
    const COLOR_DEFAULT =
      (Core.Config.Banners && Core.Config.Banners.yellowColor) || "#FFCC00";
    const DISCLAIMER_COLORS = {
      BIODERMA: "#1E6BD6", // синий
      "Institut Esthederm": "#111111", // черный
      "Etat Pur": "#6CC24A", // салатовый
      DEFAULT: COLOR_DEFAULT,
    };

    function pickDisclaimerColor(brandTitle) {
      const norm = Core.normalizeText(brandTitle || "");
      const entries = Object.entries(DISCLAIMER_COLORS).filter(
        ([k]) => k !== "DEFAULT",
      );
      const found = entries.find(([k]) => Core.normalizeText(k) === norm);
      if (found) return found[1];
      return DISCLAIMER_COLORS.DEFAULT;
    }

    function appendFootnoteSup(subtitle, footnote) {
      let res = subtitle || "";
      if (!footnote) return res;
      // заменить [1] или (1) на <sup>1</sup>
      res = res
        .replace(/\[(\d+)\]/g, "<sup>$1</sup>")
        .replace(/\((\d+)\)/g, "<sup>$1</sup>");
      if (!/<sup>\d+<\/sup>/.test(res)) {
        res = `${res} <sup>1</sup>`;
      }
      return res;
    }

    function readTzText() {
      const el = document.getElementById("nh-banners-tz");
      return el ? el.value || "" : "";
    }

    function parseKeyValues(text) {
      const lines = text.replace(/\r/g, "").split(/\n/);
      const map = {};
      let current = null;
      let buffer = [];
      const push = () => {
        if (!current) return;
        const val = buffer.join("\n").trim();
        if (!val) {
          buffer = [];
          return;
        }
        map[current] = map[current] || [];
        map[current].push(val);
        buffer = [];
      };
      lines.forEach((line) => {
        const kv = line.match(/^\s*([A-Za-zА-Яа-яёЁ\/ ]+)\s*[:\-]\s*(.*)$/);
        if (kv && kv[1]) {
          push();
          current = Core.normalizeText(kv[1]);
          buffer.push(kv[2] || "");
          return;
        }
        if (!current) return;
        buffer.push(line);
      });
      push();
      return map;
    }

    function pickFirst(map, keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) {
        const norm = Core.normalizeText(key);
        if (map[norm] && map[norm].length) return map[norm].join("\n").trim();
      }
      return "";
    }

    function toRelativeUrl(url) {
      if (!url) return "";
      let res = url.trim();
      res = res.replace(/^https?:\/\/naos\.ru/i, "");
      if (res && !res.startsWith("/")) res = "/" + res;
      return res;
    }

    function parseTz() {
      const raw = readTzText();
      const text = raw.replace(/\r/g, "").trim();
      if (!text) {
        Toast.show("ТЗ по баннеру пустое", "warn");
        Log.warn("BANNERS", "ТЗ по баннеру пустое");
        return null;
      }

      const cfg = Core.Config && Core.Config.Banners ? Core.Config.Banners : {};
      const meta = {
        internalTitle: "",
        slug: "",
        brandTitle: "",
        title: "",
        subtitle: "",
        shortDisclaimer: "АКЦИЯ",
        fullDisclaimer: "",
        ctaText: cfg.defaultButtonText || "Подробнее",
        ctaUrl: "",
        showAllLink: cfg.defaultShowAllLink || "/actions/",
        dateFrom: "",
        dateTo: "",
        disclaimerColor: COLOR_DEFAULT,
      };

      const kv = parseKeyValues(text);
      const pick = (keys) => pickFirst(kv, keys);

      const period = parsePeriod(pick(["период", "даты", "date"]) || text);
      if (period) {
        meta.dateFrom = period.from || "";
        meta.dateTo = period.to || "";
      }

      const titleKv = pick(["заголовок", "title"]);
      const subtitleKv = pick(["подзаголовок", "subtitle"]);
      const shortDiscKv = pick(["короткий дисклеймер", "дисклеймер кратко"]);
      const fullDiscKv = pick(["дисклеймер", "disclaimer", "footnote"]);
      const ctaKv = pick(["кнопка", "cta"]);
      const ctaUrlKv = pick(["url кнопки", "url", "ссылка", "target"]);
      const showAllKv = pick(["место", "раздел", "страница", "площадка"]);
      const brandKv = pick(["бренд", "brand"]);
      const altKv = pick(["alt", "alt-текст"]);

      if (titleKv) meta.title = titleKv;
      if (subtitleKv) meta.subtitle = subtitleKv;
      if (fullDiscKv) meta.fullDisclaimer = fullDiscKv;
      if (shortDiscKv) meta.shortDisclaimer = shortDiscKv;
      if (ctaKv) meta.ctaText = ctaKv;
      if (ctaUrlKv) meta.ctaUrl = toRelativeUrl(ctaUrlKv);
      if (showAllKv) meta.showAllLink = toRelativeUrl(showAllKv);
      if (brandKv) meta.brandTitle = brandKv;
      if (altKv) meta.alt = altKv;

      // Заголовок
      const titleMatch = text.match(
        /Заголовок:\s*([\s\S]*?)\n\s*Подзаголовок:/i,
      );
      if (!meta.title && titleMatch) {
        meta.title = titleMatch[1].trim();
      }

      // Подзаголовок
      const subtitleMatch = text.match(
        /Подзаголовок:\s*([\s\S]*?)\n\s*Дисклеймер/i,
      );
      if (!meta.subtitle && subtitleMatch) {
        meta.subtitle = subtitleMatch[1].trim();
      }

      // Короткий дисклеймер ("В поле дисклеймер внести слово «АКЦИЯ».")
      const shortDiscMatch = text.match(
        /в поле дисклеймер внести слово «([^»]+)»/i,
      );
      if (!meta.shortDisclaimer && shortDiscMatch) {
        meta.shortDisclaimer = shortDiscMatch[1].trim();
      }

      // Полный дисклеймер (блок после слова "Дисклеймер" до "Кнопка")
      const fullDiscMatch = text.match(/Дисклеймер\s*([\s\S]*?)\n\s*Кнопка/i);
      if (!meta.fullDisclaimer && fullDiscMatch) {
        meta.fullDisclaimer = fullDiscMatch[1].trim();
      }
      if (!meta.shortDisclaimer && meta.fullDisclaimer) {
        const firstLine = meta.fullDisclaimer.split(/\n/).find(Boolean);
        if (firstLine) meta.shortDisclaimer = firstLine.trim();
      }

      // Текст кнопки: "Кнопка «В каталог»"
      const ctaMatch = text.match(/Кнопка\s+«([^»]+)»/i);
      if (!meta.ctaText && ctaMatch) {
        meta.ctaText = ctaMatch[1].trim();
      }

      // URL CTA: "Вести на раздел https://naos.ru/catalog/packs/"
      const urlMatch = text.match(/Вести на раздел\s+(\S+)/i);
      if (!meta.ctaUrl && urlMatch) {
        let url = urlMatch[1].trim();
        // приведём к относительному виду
        url = url.replace(/^https?:\/\/naos\.ru/i, "");
        if (!url.startsWith("/")) url = "/" + url;
        meta.ctaUrl = url; // относительный путь, типа /catalog/packs/
      }

      // Дата начала/конца если явно заданы строкой "Период: ..."
      const periodLine = text.match(/Период\s*[:\-]\s*([^\n]+)/i);
      if (periodLine && !period) {
        const p = parsePeriod(periodLine[1]);
        if (p) {
          meta.dateFrom = p.from;
          meta.dateTo = p.to;
        }
      }

      // Ссылка "Смотреть все" можно получить из поля в UI (если пользователь задал)
      const urlInput = document.getElementById("nh-banners-url");
      if (urlInput && urlInput.value.trim()) {
        meta.showAllLink = urlInput.value.trim();
      }

      // Внутреннее название и slug
      meta.internalTitle = meta.title || "Banner";
      const detectedBrand = detectBrandTitle(
        text,
        meta.ctaUrl || meta.showAllLink,
      );
      if (!meta.brandTitle) {
        meta.brandTitle = detectedBrand || meta.shortDisclaimer || "Акция";
      }
      const computed = computeSlug(meta.title || "banner");
      meta.slug = computed.slug;

      Log.info("BANNERS", "ТЗ баннера разобрано", meta);
      return meta;
    }

    function buildPreview(meta) {
      const el = document.getElementById("nh-banners-preview");
      if (!el) return;
      if (!meta) {
        el.textContent = "ТЗ по баннеру не разобрано.";
        return;
      }
      const lines = [];
      lines.push(`Заголовок: ${meta.title || "—"}`);
      lines.push(`Подзаголовок: ${meta.subtitle || "—"}`);
      lines.push(`Короткий дисклеймер: ${meta.shortDisclaimer || "—"}`);
      lines.push(`Полный дисклеймер: ${meta.fullDisclaimer || "—"}`);
      lines.push(`Текст кнопки: ${meta.ctaText || "—"}`);
      lines.push(`CTA URL: ${meta.ctaUrl || "—"}`);
      lines.push(`Ссылка "Смотреть все": ${meta.showAllLink || "—"}`);
      lines.push(`Период: ${meta.dateFrom || "—"} — ${meta.dateTo || "—"}`);
      lines.push(`Slug: ${meta.slug || "—"}`);
      lines.push(`Заголовок блока: ${meta.brandTitle || "—"}`);
      el.textContent = lines.join("\n");
    }

    function applyToForm(meta) {
      if (!meta) return;
      const brandForColor =
        meta.brandTitle ||
        detectBrandTitle(meta.title || "", meta.ctaUrl || meta.showAllLink) ||
        "";
      const discColor = pickDisclaimerColor(brandForColor);

      // локальные хелперы с fallback по name
      const fillInput = (label, names, val) => {
        if (val == null || val === "") return;
        if (Dom.fillInputByLabel(label, val)) return true;
        for (const name of names || []) {
          const el = document.querySelector(`input[name="${name}"]`);
          if (el) {
            el.value = val;
            Dom.dispatchChange(el);
            Log.info(
              "DOM",
              `Заполнен input по name "${name}" значением "${val}"`,
            );
            return true;
          }
        }
        return false;
      };

      const fillTextarea = (label, names, val) => {
        if (val == null) return;
        if (Dom.fillTextareaByLabel(label, val)) return true;
        for (const name of names || []) {
          const ta = document.querySelector(`textarea[name="${name}"]`);
          if (ta) {
            ta.value = val;
            Dom.dispatchChange(ta);
            Log.info(
              "DOM",
              `Заполнена textarea по name "${name}" (${(val || "").length} символов)`,
            );
            return true;
          }
        }
        return false;
      };

      const fillSelect = (label, names, val) => {
        if (!val) return;
        if (Dom.fillSelectByLabel(label, val)) return true;
        for (const name of names || []) {
          const sel = document.querySelector(`select[name="${name}"]`);
          if (!sel) continue;
          const normTarget = Core.normalizeText(val);
          for (const opt of sel.options) {
            if (Core.normalizeText(opt.textContent || "") === normTarget) {
              sel.value = opt.value;
              Dom.dispatchChange(sel);
              Log.info("DOM", `Выбран select по name "${name}" => "${val}"`);
              return true;
            }
          }
        }
        return false;
      };

      const selectMulti = (label, names, vals) => {
        if (Dom.selectFromUiMultiselect(label, vals)) return true;
        // доп. попытка по нескольким лейблам (например, Тип устройств/Тип устройства)
        if (Array.isArray(label)) {
          for (const l of label) {
            if (Dom.selectFromUiMultiselect(l, vals)) return true;
          }
        }
        for (const name of names || []) {
          const sel = document.querySelector(`select[name="${name}"]`);
          if (!sel) continue;
          const normVals = (vals || []).map((v) => Core.normalizeText(v));
          for (const opt of sel.options) {
            if (normVals.includes(Core.normalizeText(opt.textContent || ""))) {
              opt.selected = true;
            }
          }
          Dom.dispatchChange(sel);
          return true;
        }
        return false;
      };

      // Основные служебные поля
      fillInput(
        "Внутреннее название",
        ["general[internal_title]"],
        meta.internalTitle,
      );
      if (!Dom.setSwitchByLabel("Включен", true)) {
        const sw = document.querySelector(
          'input[type="checkbox"][name*="is_active"]',
        );
        if (sw && !sw.checked) {
          sw.click();
          Log.info("DOM", "Тумблер включен через name is_active");
        }
      }
      fillInput("slug", ["general[slug]"], meta.slug);
      selectMulti("Сайты", ["general[website_ids][]"], ["Main Website"]);
      if (
        !selectMulti(
          ["Тип устройств", "Тип устройства"],
          ["general[device_type][]"],
          ["Все устройства"],
        ) &&
        !fillSelect(
          "Тип устройств",
          ["general[device_type]", "general[device_type][]"],
          "Все устройства",
        )
      ) {
        const sel = document.querySelector(
          'select[name="general[device_type]"], select[name="general[device_type][]"]',
        );
        if (sel) {
          for (const opt of sel.options) {
            if (
              Core.normalizeText(opt.textContent || "") ===
              Core.normalizeText("Все устройства")
            ) {
              sel.value = opt.value;
              Dom.dispatchChange(sel);
              Log.info(
                "DOM",
                "Выбран тип устройств => Все устройства (fallback)",
              );
              break;
            }
          }
        }
      }
      fillSelect("Тип сущности", ["general[entity_type]"], "Баннер");
      fillSelect("Тип баннера", ["general[banner_type]"], "Slider item");
      fillSelect("Тема", ["entity_data[theme]"], "Light");
      fillSelect("Text Position", ["entity_data[text_position]"], "Left");
      fillInput("Порядок сортировки", ["general[sort_order]"], "10");

      // Период показа
      if (meta.dateFrom)
        fillInput("Показывать от", ["general[show_from]"], meta.dateFrom);
      if (meta.dateTo)
        fillInput("Показывать до", ["general[show_to]"], meta.dateTo);

      // Контент
      if (meta.title)
        fillTextarea("Крупный текст", ["entity_data[large_text]"], meta.title);
      if (meta.subtitle) {
        const subtitleWithSup = appendFootnoteSup(
          meta.subtitle,
          meta.fullDisclaimer || meta.shortDisclaimer,
        );
        fillTextarea(
          "Маленький текст",
          ["entity_data[small_text]"],
          subtitleWithSup,
        );
      }

      // Дисклеймеры и footnote
      const footnoteText = meta.fullDisclaimer || meta.shortDisclaimer;
      if (footnoteText) {
        const footnoteClean = footnoteText
          .replace(/\s*\n\s*/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        fillInput("Footnote", ["entity_data[footnote]"], footnoteClean);
      }
      if (meta.shortDisclaimer) {
        // поле цвета дисклеймера
        if (!fillInput("Дисклеймер", ["entity_data[disclaimer]"], discColor)) {
          fillInput("Цвет дисклеймера", ["entity_data[disclaimer]"], discColor);
        }
        fillInput(
          "Лейбл скидки",
          ["entity_data[discount_label]", "entity_data[label_text]"],
          meta.shortDisclaimer,
        );
        // текст дисклеймера заполняем только по name, чтобы не перетирать цвет
        fillInput(
          "Текст дисклеймера",
          ["entity_data[disclaimer_text]"],
          meta.shortDisclaimer,
        );
      }

      // Заголовок блока (если есть отдельное поле)
      if (meta.brandTitle)
        fillInput("Заголовок", ["entity_data[title]"], meta.brandTitle);

      // CTA
      if (meta.ctaText) {
        fillInput(
          "Текст CTA-ссылки",
          ["entity_data[first_link_label]"],
          meta.ctaText,
        );
      }
      if (meta.ctaUrl) {
        // для поля "Первая CTA-ссылка" лучше сразу полный URL
        const fullUrl = meta.ctaUrl.startsWith("http")
          ? meta.ctaUrl
          : "https://naos.ru" + meta.ctaUrl;
        fillInput("Первая CTA-ссылка", ["entity_data[first_link]"], fullUrl);
      }

      // Ссылка "Смотреть все"
      if (meta.showAllLink) {
        fillInput(
          `Ссылка 'Смотреть все'`,
          ["entity_data[show_all_link]"],
          meta.showAllLink,
        );
      }

      // Ссылка на баннер (если есть)
      if (meta.ctaUrl) {
        const fullUrl = meta.ctaUrl.startsWith("http")
          ? meta.ctaUrl
          : "https://naos.ru" + meta.ctaUrl;
        fillInput("Ссылка на баннер", ["entity_data[banner_link]"], fullUrl);
      }

      Log.info("BANNERS", "Форма баннера заполнена по ТЗ");
      Toast.show("Баннер заполнен по ТЗ", "info");
    }

    function handleParseClick() {
      try {
        Log.info("BANNERS", "Старт разбора ТЗ баннера");
        const meta = parseTz();
        if (!meta) return;
        State.setJson(STATE_KEY, meta);
        buildPreview(meta);
        Toast.show("ТЗ баннера разобрано, можно заполнять форму", "info");
      } catch (e) {
        Log.error("BANNERS", "Ошибка при разборе ТЗ: " + e.message);
        Toast.show("Ошибка при разборе ТЗ баннера, смотри лог", "error");
      }
    }

    function handleFillClick() {
      try {
        let meta = State.getJson(STATE_KEY, null);
        if (!meta) {
          Log.warn(
            "BANNERS",
            "Нет сохранённого результата разбора, парсю заново",
          );
          meta = parseTz();
        }
        if (!meta) {
          Toast.show("Сначала нажми «Разобрать ТЗ» для баннера", "warn");
          return;
        }
        const start = Date.now();
        const tryFill = () => {
          const hasBaseFields =
            document.querySelector('input[name="general[internal_title]"]') ||
            Dom.findFieldByLabel("Внутреннее название");
          if (!hasBaseFields && Date.now() - start < 2000) {
            setTimeout(tryFill, 200);
            return;
          }
          applyToForm(meta);
        };
        tryFill();
      } catch (e) {
        Log.error("BANNERS", "Ошибка заполнения формы: " + e.message);
        Toast.show("Ошибка при заполнении баннера, смотри лог", "error");
      }
    }

    function init() {
      const stored = State.getJson(STATE_KEY, null);
      if (stored) buildPreview(stored);
      Log.info("BANNERS", "Banners-модуль инициализирован");
    }

    // --- Helpers: dates and slug ---
    const MONTHS = {
      янв: 0,
      января: 0,
      фев: 1,
      февраля: 1,
      мар: 2,
      марта: 2,
      апр: 3,
      апреля: 3,
      мая: 4,
      май: 4,
      июн: 5,
      июня: 5,
      июл: 6,
      июля: 6,
      авг: 7,
      августа: 7,
      сен: 8,
      сентября: 8,
      окт: 9,
      октября: 9,
      ноя: 10,
      ноября: 10,
      дек: 11,
      декабря: 11,
    };

    function parsePeriod(str) {
      if (!str) return null;
      const text = str.toLowerCase();
      const isoRange = text.match(
        /(\d{1,2})\.(\d{1,2})\.(\d{4})\s*[\-\u2013\u2014]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/,
      );
      if (isoRange) {
        const from = formatDateRu(
          new Date(
            parseInt(isoRange[3], 10),
            parseInt(isoRange[2], 10) - 1,
            parseInt(isoRange[1], 10),
          ),
        );
        const to = formatDateRu(
          new Date(
            parseInt(isoRange[6], 10),
            parseInt(isoRange[5], 10) - 1,
            parseInt(isoRange[4], 10),
          ),
        );
        return { from, to };
      }
      const wordRange = text.match(
        /(\d{1,2})\s*[\-\u2013\u2014]\s*(\d{1,2})\s+([а-яё]+)/i,
      );
      if (wordRange) {
        const mon =
          MONTHS[wordRange[3]] != null
            ? MONTHS[wordRange[3]]
            : MONTHS[wordRange[3].slice(0, 3)];
        if (mon != null) {
          const year = new Date().getFullYear();
          const from = formatDateRu(
            new Date(year, mon, parseInt(wordRange[1], 10)),
          );
          const to = formatDateRu(
            new Date(year, mon, parseInt(wordRange[2], 10)),
          );
          return { from, to };
        }
      }
      const single = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (single) {
        const from = formatDateRu(
          new Date(
            parseInt(single[3], 10),
            parseInt(single[2], 10) - 1,
            parseInt(single[1], 10),
          ),
        );
        return { from, to: "" };
      }
      return null;
    }

    function formatDateRu(date) {
      const dd = String(date.getDate()).padStart(2, "0");
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const yyyy = date.getFullYear();
      return `${dd}.${mm}.${yyyy}`;
    }

    function computeSlug(sourceTitle) {
      const base = Core.slugifyRu(sourceTitle || "banner");
      // если на форме уже есть значение slug — увеличим его на 1
      const slugField = document.querySelector('input[name="general[slug]"]');
      const currentSlug = ((slugField && slugField.value) || "").trim();
      const inc = (str, re, build) => {
        const m = str.match(re);
        if (m) {
          const num = parseInt(m[1], 10) || 0;
          return build(num + 1);
        }
        return "";
      };
      const fromCurrent =
        inc(currentSlug, /slider_main_(\d+)/i, (n) => `slider_main_${n}`) ||
        inc(currentSlug, /slide_(\d+)_/i, (n) => `slide_${n}_brand`) ||
        inc(
          currentSlug,
          /sl_(\d+)_minibanners_pdp/i,
          (n) => `sl_${n}_minibanners_pdp`,
        );

      const cells = Array.from(
        document.querySelectorAll(".data-grid-cell-content"),
      );
      let maxMain = 0;
      let maxBrand = 0;
      let maxPdp = 0;
      cells.forEach((c) => {
        const t = (c.textContent || "").trim();
        const m1 = t.match(/slider_main_(\d+)/i);
        if (m1) maxMain = Math.max(maxMain, parseInt(m1[1], 10) || 0);
        const m2 = t.match(/slide_(\d+)_/i);
        if (m2) maxBrand = Math.max(maxBrand, parseInt(m2[1], 10) || 0);
        const m3 = t.match(/sl_(\d+)_minibanners_pdp/i);
        if (m3) maxPdp = Math.max(maxPdp, parseInt(m3[1], 10) || 0);
      });

      // выбираем тип из чекбоксов панели
      const useMain =
        document.getElementById("nh-banners-main")?.checked !== false;
      const useBrand = document.getElementById("nh-banners-brands")?.checked;
      const usePdp = document.getElementById("nh-banners-pdp")?.checked;

      if (useMain) {
        return { slug: fromCurrent || `slider_main_${maxMain + 1 || 1}` };
      }
      if (useBrand) {
        return { slug: fromCurrent || `slide_${maxBrand + 1 || 1}_brand` };
      }
      if (usePdp) {
        return { slug: fromCurrent || `sl_${maxPdp + 1 || 1}_minibanners_pdp` };
      }
      return { slug: fromCurrent || base };
    }

    function detectBrandTitle(text, url) {
      const lower =
        (text || "").toLowerCase() + " " + (url || "").toLowerCase();
      if (lower.includes("bioderma") || lower.includes("/bioderma"))
        return "Bioderma";
      if (lower.includes("esthederm") || lower.includes("/institut-esthederm"))
        return "Institut Esthederm";
      if (lower.includes("etat pur") || lower.includes("/etat-pur"))
        return "Etat Pur";
      if (lower.includes("akcia") || lower.includes("акция")) return "АКЦИЯ";
      return "";
    }

    return {
      init,
      handleParseClick,
      handleFillClick,
    };
  })();

  SH.Modules.Promos = (function () {
    const Log = Core.Log;
    const Toast = Core.Toast;
    const Dom = Core.Dom;
    const State = Core.State;
    const Router = Core.Router;
    const Config = Core.Config.Promos || {};
    const GAMMAS = [
      "ATODERM",
      "SEBIUM",
      "HYDRABIO",
      "EXCELLAGE",
      "EXCELLAGE NT",
      "INTENSIVE",
      "INTENSIVE PRO-COLLAGEN+",
      "PRO-COLLAGEN",
      "INTENSIVE HYALURONIC+",
      "SUNCARE",
      "PHOTO REVERSE",
      "INTO REPAIR",
      "BODY",
      "АТОДЕРМ",
      "СЕБИУМ",
      "ГИДРАБИО",
      "ЭКСЦЕЛЛАЖ",
      "ЭКСЕЛЛАЖ",
      "ЭКСЦЕЛЬЯЖ",
      "ИНТЕНСИВ",
      "ПРО-КОЛЛАГЕН",
      "ГИАЛУРОНИК",
    ];

    const STATE_LAST = "PROMO_LAST_PARSED_V1";
    const STATE_QUEUE = "PROMO_QUEUE_V1";
    const STATE_AUTOPILOT = "PROMO_AUTOPILOT_V1";

    const MONTHS = {
      янв: 0,
      январ: 0,
      фев: 1,
      феврал: 1,
      мар: 2,
      март: 2,
      апр: 3,
      апрел: 3,
      мая: 4,
      май: 4,
      июн: 5,
      июля: 6,
      июл: 6,
      авг: 7,
      август: 7,
      сен: 8,
      сентябр: 8,
      окт: 9,
      октябр: 9,
      ноя: 10,
      ноябр: 10,
      дек: 11,
      декабр: 11,
    };

    function cleanText(str) {
      return (str || "")
        .replace(/\u00A0/g, " ")
        .replace(/\r/g, "")
        .trim();
    }

    function normalize(str) {
      return Core.normalizeText(str || "");
    }

    function unique(list) {
      return Array.from(new Set(list.filter(Boolean)));
    }

    function formatDate(dd, mm, yyyy) {
      const d = String(dd).padStart(2, "0");
      const m = String(mm + 1).padStart(2, "0");
      return `${d}.${m}.${yyyy}`;
    }

    function detectDates(text) {
      const lower = normalize(text);
      const yearNow = new Date().getFullYear();
      const range = lower.match(
        /(\d{1,2})[\.\/\-](\d{1,2})[\.\/\-](\d{2,4}).{0,20}?(\d{1,2})[\.\/\-](\d{1,2})[\.\/\-](\d{2,4})/,
      );
      if (range) {
        const y1 = parseInt(
          range[3].length === 2 ? "20" + range[3] : range[3],
          10,
        );
        const y2 = parseInt(
          range[6].length === 2 ? "20" + range[6] : range[6],
          10,
        );
        return {
          startDate: formatDate(
            parseInt(range[1], 10),
            parseInt(range[2], 10) - 1,
            y1,
          ),
          endDate: formatDate(
            parseInt(range[4], 10),
            parseInt(range[5], 10) - 1,
            y2,
          ),
        };
      }
      const wordRangePo = lower.match(
        /(?:с\s*)?(\d{1,2})\s*(?:по|до|[-–—])\s*(\d{1,2})\s+([а-яё]+)/i,
      );
      if (wordRangePo) {
        const mon =
          MONTHS[wordRangePo[3].slice(0, 3)] ??
          MONTHS[wordRangePo[3].slice(0, 4)];
        if (mon != null) {
          return {
            startDate: formatDate(parseInt(wordRangePo[1], 10), mon, yearNow),
            endDate: formatDate(parseInt(wordRangePo[2], 10), mon, yearNow),
          };
        }
      }
      const wordRange = lower.match(
        /(\d{1,2})\s*[–—\-]\s*(\d{1,2})\s+([а-яё]+)/i,
      );
      if (wordRange) {
        const mon =
          MONTHS[wordRange[3].slice(0, 3)] ?? MONTHS[wordRange[3].slice(0, 4)];
        if (mon != null) {
          return {
            startDate: formatDate(parseInt(wordRange[1], 10), mon, yearNow),
            endDate: formatDate(parseInt(wordRange[2], 10), mon, yearNow),
          };
        }
      }
      const singleWord = lower.match(/(\d{1,2})\s+([а-яё]+)/i);
      if (singleWord) {
        const mon =
          MONTHS[singleWord[2].slice(0, 3)] ??
          MONTHS[singleWord[2].slice(0, 4)];
        if (mon != null) {
          return {
            startDate: formatDate(parseInt(singleWord[1], 10), mon, yearNow),
            endDate: "",
          };
        }
      }
      const single = lower.match(/(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{2,4})/);
      if (single) {
        const y = parseInt(
          single[3].length === 2 ? "20" + single[3] : single[3],
          10,
        );
        return {
          startDate: formatDate(
            parseInt(single[1], 10),
            parseInt(single[2], 10) - 1,
            y,
          ),
          endDate: "",
        };
      }
      return null;
    }

    function detectBrands(text) {
      const brands = [];
      Object.keys(Config.brandPriority || {}).forEach((b) => {
        if (normalize(text).includes(normalize(b))) brands.push(b);
      });
      return brands.length ? brands : [];
    }

    function detectGamma(text) {
      const src = text || "";
      for (const g of GAMMAS) {
        const pattern = g
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\s+/g, "\\s+");
        const re = new RegExp(`\\b${pattern}\\b`, "i");
        if (re.test(src)) return g.replace(/\s+/g, " ").trim();
      }
      return "";
    }

    function detectPromoType(text) {
      const src = normalize(text);
      const map = Config.promoTypeKeywords || {};
      for (const [code, keys] of Object.entries(map)) {
        if ((keys || []).some((k) => src.includes(normalize(k)))) return code;
      }
      if (src.includes("скидк")) return "discount";
      return "discount";
    }

    function extractSkus(block) {
      const skus = [];
      const lines = (block || "").split(/\n+/);
      lines.forEach((line) => {
        const found = line.match(/(\d[0-9A-Z]{3,})/g);
        if (found) skus.push(...found);
      });
      return unique(
        skus
          .map((s) => s.toUpperCase())
          .filter((s) => /^\d[0-9A-Z]+$/.test(s))
          .filter((s) => s.length >= 4 && s.length <= 12),
      );
    }

    function mapSkus(list) {
      const map = Config.skuMap || {};
      return unique(list.map((s) => map[s] || s));
    }

    function parseSections(raw) {
      const sections = {};
      const lines = cleanText(raw).split(/\n+/);
      let current = "text";
      const headers = [
        { key: "title", re: /заголовок/i },
        { key: "subtitle", re: /подзаголов/i },
        { key: "period", re: /период|дата|dates?/i },
        { key: "brands", re: /бренд/i },
        { key: "skus", re: /sku|артикул|товар|позиции/i },
        { key: "conditions", re: /услов|механик|тип акции|скидк|подар/i },
        { key: "text", re: /описан|текст|copy|копирайт/i },
        { key: "disclaimer", re: /дисклеймер|ограничен|footnote|примечан/i },
        { key: "button", re: /кнопк|cta/i },
        { key: "circle", re: /кружк|circle/i },
        { key: "urls", re: /url|ссылк|раздел|лендинг/i },
        { key: "service", re: /служеб|внутрен/i },
      ];
      lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (/^создать\s+страниц/i.test(trimmed)) {
          current = "service";
          return;
        }
        const header = headers.find((h) => h.re.test(trimmed));
        if (header) {
          current = header.key;
          const rest = trimmed
            .replace(header.re, "")
            .replace(/^[:\-–—]\s*/, "")
            .trim();
          if (rest) {
            sections[current] = sections[current] || [];
            sections[current].push(rest);
          }
          return;
        }
        sections[current] = sections[current] || [];
        sections[current].push(trimmed);
      });
      return sections;
    }

    function parseOneBlock(raw) {
      let text = cleanText(raw);
      if (!text) {
        return null;
      }
      const circleMatch = text.match(
        /текст\s+рядом\s+с\s+кружк[оа]м?\s*:?\s*([\s\S]*?)(?:\n\d+\.|$)/i,
      );
      const circleText =
        circleMatch && circleMatch[1] ? circleMatch[1].trim() : "";
      if (circleMatch && circleMatch[0]) {
        text = text.replace(circleMatch[0], "").trim();
      }
      const sections = parseSections(text);
      const whole = text;

      const dates = detectDates((sections.period || []).join(" ") || whole);
      const brands = detectBrands((sections.brands || []).join(" ") || whole);
      const promoType = detectPromoType(
        (sections.conditions || sections.text || []).join(" ") || whole,
      );
      const discountMatch = whole.match(/(\d{1,2})\s*%/);
      const discountValue = discountMatch
        ? parseInt(discountMatch[1], 10)
        : null;
      const subtitle = (sections.subtitle || []).join(" ").trim();
      const buttonText = (sections.button || []).join(" ").trim();

      const textLines = (sections.text || []).filter((l) => {
        const norm = normalize(l);
        if (!norm) return false;
        if (/^создать\s+страниц/i.test(norm)) return false;
        if (/^товары/i.test(norm)) return false;
        if (/^заголовок/i.test(norm)) return false;
        return true;
      });

      // удаляем строки, которые состоят только из названия гаммы/бренда
      const gammaLower = GAMMAS.map((g) => normalize(g));
      const brandLower = Object.keys(Config.brandPriority || {}).map((b) =>
        normalize(b),
      );
      const cleanedTextLines = textLines.filter((line) => {
        const n = normalize(line);
        if (!n) return false;
        if (gammaLower.includes(n)) return false;
        if (brandLower.includes(n)) return false;
        return true;
      });

      const urls = [];
      (sections.urls || []).forEach((u) => {
        const clean = (u || "").trim();
        if (clean) urls.push(clean);
      });
      const urlRe = /(https?:\/\/[^\s]+)/gi;
      let m;
      while ((m = urlRe.exec(whole))) urls.push(m[1].replace(/[,.;]+$/, ""));

      let titleCandidate = "";
      if (sections.title && sections.title.length) {
        titleCandidate = sections.title.join(" ").trim();
      }
      if (!titleCandidate) {
        const titleExplicit = whole.match(
          /заголовок[:\-]?\s*([\s\S]*?)(?:\n\s*\n|текст:)/i,
        );
        if (titleExplicit && titleExplicit[1])
          titleCandidate = titleExplicit[1].trim();
      }
      if (!titleCandidate)
        titleCandidate = (textLines && textLines[0]) || whole.split("\n")[0];

      const gammaDetected = detectGamma(titleCandidate || whole);
      const circleFromSection = (sections.circle || []).join("\n").trim();

      // если есть явный блок "Товары" – выдернем из него
      const goodsBlock = whole.split(/товары\s*(акции|страницы)?/i)[1];
      if (goodsBlock) {
        const gbLines = goodsBlock.split(/\n/);
        const skusFromBlock = extractSkus(gbLines.join("\n"));
        if (skusFromBlock.length) {
          sections.skus = sections.skus || [];
          sections.skus.push(...skusFromBlock);
        }
      }
      const skusRaw = extractSkus((sections.skus || []).join("\n"));
      const mappedSkus = mapSkus(skusRaw);

      const internal = (sections.service || []).join(" ");

      const parsed = {
        meta: {
          internalName: internal || titleCandidate || "promo",
          title: titleCandidate || "Акция",
          slug: "",
          subtitle: subtitle || "",
          ctaText: buttonText || "",
          startDate: dates ? dates.startDate : "",
          endDate: dates ? dates.endDate : "",
          brands,
          mainBrand: brands[0] || "",
          gamma: gammaDetected || "",
          promoType,
          discountValue: discountValue || null,
        },
        products: {
          rawSkus: skusRaw,
          mappedSkus,
          giftsSkus: [],
          setsSkus: [],
        },
        texts: {
          short: cleanedTextLines.join("\n").trim(),
          full: cleanedTextLines.join("\n").trim(),
          landingIntro: "",
          circle: circleFromSection || circleText,
          disclaimerShort: (sections.disclaimer || []).join("\n").trim(),
          disclaimerFull: (sections.disclaimer || []).join("\n").trim(),
        },
        urls: {
          main: unique(urls)[0] || "",
          related: unique(urls).slice(1),
        },
        flags: {
          onlineOnly: normalize(whole).includes("онлайн"),
          d2cOnly: normalize(whole).includes("d2c"),
        },
        source: {
          raw,
        },
      };
      if (!parsed.texts.full && cleanedTextLines.length) {
        parsed.texts.full = cleanedTextLines.join("\n").trim();
      }
      if (!parsed.texts.disclaimerFull && Config.defaultDisclaimers?.full) {
        parsed.texts.disclaimerFull = Config.defaultDisclaimers.full;
      }
      if (!parsed.texts.disclaimerShort && parsed.texts.disclaimerFull) {
        parsed.texts.disclaimerShort = parsed.texts.disclaimerFull;
      }

      const slugBase = Core.slugifyRu
        ? Core.slugifyRu(parsed.meta.title || "promo")
        : "promo";
      const datePart = parsed.meta.startDate
        ? parsed.meta.startDate.replace(/\D/g, "").slice(0, 8)
        : Core.todayYMD().replace(/\D/g, "");
      parsed.meta.slug = (Config.slugTemplate || "promo-{date}-{slug}")
        .replace("{date}", datePart)
        .replace("{slug}", slugBase);

      return parsed;
    }

    function splitMulti(raw) {
      const blocks = [];
      const lines = raw.replace(/\r/g, "").split(/\n/);
      let current = [];
      lines.forEach((line) => {
        const numMatch = line.match(/^\s*\d+\.\s+(.*)/);
        if (numMatch) {
          if (current.length) blocks.push(current.join("\n"));
          current = [numMatch[1] || ""];
          return;
        }
        current.push(line);
      });
      if (current.length) blocks.push(current.join("\n"));
      return blocks.map((b) => b.trim()).filter(Boolean);
    }

    function parseTz(raw) {
      const text = cleanText(raw);
      if (!text) {
        Toast.show("Нет текста ТЗ для разбора", "warn");
        return null;
      }
      const blocks = splitMulti(text);
      if (blocks.length > 1) {
        const parsedAll = blocks.map((b) => parseOneBlock(b)).filter(Boolean);
        if (!parsedAll.length) return null;
        // первый — текущий, остальные в очередь
        const [first, ...rest] = parsedAll;
        const queue = loadQueue();
        rest.forEach((p) => {
          queue.push({
            id: Date.now() + Math.random(),
            tz: p.source?.raw || "",
            parsed: p,
            status: "pending",
            addedAt: Date.now(),
          });
        });
        if (rest.length) {
          saveQueue(queue);
          renderQueue();
          Toast.show(`В очередь добавлено ещё ${rest.length} акций`, "info");
        }
        return first;
      }
      return parseOneBlock(text);
    }

    function buildPreview(parsed) {
      const el = document.getElementById("nh-promos-preview");
      if (!el) return;
      if (!parsed) {
        el.textContent = "Нет разобранного ТЗ.";
        return;
      }
      const meta = parsed.meta || {};
      const products = parsed.products || {};
      const lines = [];
      lines.push(`Название: ${meta.title || "—"}`);
      lines.push(`Подзаголовок: ${meta.subtitle || "—"}`);
      lines.push(
        `Бренд: ${meta.mainBrand || (meta.brands || []).join(", ") || "—"}`,
      );
      lines.push(`Период: ${meta.startDate || "—"} — ${meta.endDate || "—"}`);
      lines.push(
        `Тип: ${meta.promoType || "—"}${meta.discountValue ? ` (${meta.discountValue}%)` : ""}`,
      );
      lines.push(`CTA: ${meta.ctaText || "—"}`);
      lines.push(
        `SKU: ${products.mappedSkus && products.mappedSkus.length ? products.mappedSkus.join(", ") : "—"}`,
      );
      lines.push(`Ссылка: ${parsed.urls?.main || "—"}`);
      lines.push(`Дисклеймер: ${parsed.texts?.disclaimerShort || "—"}`);
      el.textContent = lines.join("\n");
    }

    const PromoDom = {
      fillInput(label, names, val) {
        if (Dom.fillInputByLabel(label, val)) return true;
        return (names || []).some((n) => {
          const el = document.querySelector(`input[name="${n}"]`);
          if (el) {
            el.value = val || "";
            Dom.dispatchChange(el);
            return true;
          }
          return false;
        });
      },
      fillTextarea(label, names, val) {
        if (Dom.fillTextareaByLabel(label, val)) return true;
        return (names || []).some((n) => {
          const ta = document.querySelector(`textarea[name="${n}"]`);
          if (ta) {
            ta.value = val || "";
            Dom.dispatchChange(ta);
            return true;
          }
          return false;
        });
      },
      fillWysiwyg(label, names, html) {
        if (Dom.fillWysiwygByLabel(label, html)) return true;
        return (names || []).some((n) => {
          const ta = document.querySelector(`textarea[name="${n}"]`);
          if (ta) {
            ta.value = html || "";
            Dom.dispatchChange(ta);
            try {
              if (window.tinyMCE && window.tinyMCE.get(ta.id))
                window.tinyMCE.get(ta.id).setContent(html || "");
            } catch (e) {
              /* noop */
            }
            return true;
          }
          return false;
        });
      },
      setSwitch(label, names, val) {
        if (Dom.setSwitchByLabel(label, val)) return true;
        return (names || []).some((n) => {
          const input = document.querySelector(`input[name="${n}"]`);
          if (input && input.type === "checkbox") {
            if (input.checked !== !!val) input.click();
            return true;
          }
          return false;
        });
      },
      fillSelect(label, names, value) {
        if (Dom.fillSelectByLabel(label, value)) return true;
        return (names || []).some((n) => {
          const sel = document.querySelector(`select[name="${n}"]`);
          if (!sel) return false;
          for (const opt of sel.options) {
            if (
              normalize(opt.textContent) === normalize(value) ||
              opt.value === value
            ) {
              sel.value = opt.value;
              Dom.dispatchChange(sel);
              return true;
            }
          }
          return false;
        });
      },
    };

    function toDateTimeValue(dateStr, endOfDay) {
      if (!dateStr) return "";
      const parts = dateStr.split(".");
      if (parts.length < 3) return dateStr;
      return `${parts[0]}.${parts[1]}.${parts[2]} ${endOfDay ? "23:59" : "00:00"}`;
    }

    function textToHtmlPreserve(str) {
      const t = (str || "").trim();
      if (!t) return "";
      const safe = Core.escapeHtml(t);
      const strong = Core.strongify(safe);
      const blocks = strong
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean);
      const html = blocks
        .map((b) => `<p>${b.replace(/\n/g, "<br>")}</p>`)
        .join("\n");
      return Core.wrapTextStyled(html);
    }

    function applyToForm(parsed) {
      if (!parsed) {
        Toast.show("Нет данных для заполнения акции", "warn");
        return;
      }
      const ctx = Router.getContext();
      if (ctx !== "promo_edit") {
        Toast.show("Открой страницу создания/редактирования акции", "warn");
        return;
      }

      PromoDom.setSwitch("Активен", ["is_active"], true);
      if (!PromoDom.fillSelect("Магазин", ["store_id"], "Main Website Store")) {
        if (!PromoDom.fillSelect("Магазин", ["store_id"], "Main Website")) {
          const sel = document.querySelector('select[name="store_id"]');
          if (sel && sel.options.length) {
            const first =
              Array.from(sel.options).find((o) => o.value) || sel.options[0];
            sel.value = first.value;
            Dom.dispatchChange(sel);
          }
        }
      }
      PromoDom.fillInput("Заголовок", ["title"], parsed.meta.title);
      // Тип промо
      const typeHumanMap = {
        discount: "Скидка",
        gift: "Подарок",
        cashback: "Повышенный кешбэк",
        two_equal_one: "2=1",
        set: "Скидка",
      };
      const typeValue = typeHumanMap[parsed.meta.promoType] || "Скидка";
      PromoDom.fillSelect("Тип", ["promo_type"], typeValue);

      if (parsed.meta.mainBrand)
        PromoDom.fillSelect(
          "Название бренда",
          ["brand_name"],
          parsed.meta.mainBrand,
        );
      if (parsed.meta.startDate)
        PromoDom.fillInput(
          "Дата начала",
          ["start_date"],
          toDateTimeValue(parsed.meta.startDate, false),
        );
      if (parsed.meta.endDate)
        PromoDom.fillInput(
          "Дата окончания",
          ["end_date"],
          toDateTimeValue(parsed.meta.endDate, true),
        );
      // Erid по просьбе — не заполняем
      if (parsed.products.mappedSkus?.length) {
        PromoDom.fillTextarea(
          "Артикул продукта",
          ["product_skus"],
          parsed.products.mappedSkus.join(","),
        );
      }
      const descriptionHtml =
        parsed.texts.full || parsed.texts.short || parsed.meta.title || "";
      if (descriptionHtml)
        PromoDom.fillWysiwyg(
          "Описание",
          ["description"],
          textToHtmlPreserve(descriptionHtml),
        );
      if (parsed.texts.circle) {
        PromoDom.fillWysiwyg(
          "Описание после списка товаров",
          ["description_after"],
          textToHtmlPreserve(parsed.texts.circle),
        );
      } else if (parsed.texts.landingIntro) {
        PromoDom.fillWysiwyg(
          "Описание после списка товаров",
          ["description_after"],
          textToHtmlPreserve(parsed.texts.landingIntro),
        );
      }
      const disclaimerHtml =
        parsed.texts.disclaimerFull ||
        parsed.texts.disclaimerShort ||
        Config.defaultDisclaimers?.full ||
        "";
      if (disclaimerHtml) {
        PromoDom.fillWysiwyg(
          "Дисклеймер",
          ["disclaimer"],
          textToHtmlPreserve(disclaimerHtml),
        );
      }
      // Категория для кнопки "Перейти в каталог": сначала гамма, потом бренд, потом дефолт
      const catValues = [];
      if (parsed.meta.gamma) catValues.push(parsed.meta.gamma);
      if (parsed.meta.mainBrand) catValues.push(parsed.meta.mainBrand);
      const lowerTitle = (parsed.meta.title || "").toLowerCase();
      if (
        parsed.meta.promoType === "set" ||
        /набор/i.test(parsed.meta.title || "")
      )
        catValues.push("Наборы");
      if (lowerTitle.includes("bioderma")) catValues.push("BIODERMA");
      if (lowerTitle.includes("esthederm"))
        catValues.push("Institut Esthederm");
      if (lowerTitle.includes("etat pur")) catValues.push("Etat Pur");
      if (!catValues.length) catValues.push("Default Category");
      const catList = unique(catValues);
      if (catList.length) {
        const catLabels = [
          "Категория для кнопки «Перейти в каталог»",
          'Категория для кнопки "Перейти в каталог"',
          "Категория для кнопки <Перейти в каталог>",
          "Категория для кнопки Перейти в каталог",
          "Категория для кнопки <Перейти в каталог>",
        ];
        for (const lbl of catLabels) {
          if (Dom.selectFromUiMultiselect(lbl, catList)) break;
          if (Dom.fillSelectByLabel(lbl, catList[0])) break;
        }
      }
      Log.info("PROMOS", "Форма акции заполнена");
      Toast.show("Акция заполнена: проверь и сохрани", "info");
    }

    function loadQueue() {
      return State.getJson(STATE_QUEUE, []);
    }

    function saveQueue(queue) {
      State.setJson(STATE_QUEUE, queue || []);
    }

    function renderQueue() {
      const el = document.getElementById("nh-promos-queue");
      if (!el) return;
      const queue = loadQueue();
      if (!queue.length) {
        el.textContent = "Очередь пуста.";
        return;
      }
      const sorted = queue
        .slice()
        .sort(
          (a, b) =>
            (a.status === "pending" ? 0 : 1) -
              (b.status === "pending" ? 0 : 1) ||
            (a.addedAt || 0) - (b.addedAt || 0),
        );
      const lines = sorted.map((item, idx) => {
        const p = item.parsed?.meta || {};
        const brand = p.mainBrand || (p.brands || []).join(", ");
        const period = p.startDate ? `${p.startDate} → ${p.endDate || ""}` : "";
        return `${idx + 1}. ${brand || "—"} | ${p.title || "Без названия"} | ${period} | ${item.status || "pending"}`;
      });
      el.textContent = lines.join("\n");
    }

    function handleParseClick() {
      const ta = document.getElementById("nh-promos-tz");
      const raw = ta ? ta.value : "";
      const parsed = parseTz(raw);
      if (!parsed) return;
      State.setJson(STATE_LAST, parsed);
      buildPreview(parsed);
      Log.info("PROMOS", "ТЗ акции разобрано");
      Toast.show("ТЗ акции разобрано", "info");
    }

    function handleFillClick() {
      let parsed = State.getJson(STATE_LAST, null);
      if (!parsed) {
        handleParseClick();
        parsed = State.getJson(STATE_LAST, null);
      }
      if (!parsed) return;
      applyToForm(parsed);
    }

    function handleQueueAdd() {
      const ta = document.getElementById("nh-promos-tz");
      const raw = ta ? ta.value : "";
      const parsed = parseTz(raw);
      if (!parsed) return;
      const queue = loadQueue();
      queue.push({
        id: Date.now(),
        tz: raw,
        parsed,
        status: "pending",
        addedAt: Date.now(),
      });
      saveQueue(queue);
      renderQueue();
      Toast.show("Акция добавлена в очередь", "info");
    }

    function pickNext() {
      const queue = loadQueue().filter(
        (q) => q.status !== "done" && q.status !== "skipped",
      );
      if (!queue.length) return null;
      const withPriority = queue.slice().map((item) => {
        const brand = item.parsed?.meta?.mainBrand || "";
        const priority = Config.brandPriority?.[brand] || 999;
        return { item, priority };
      });
      withPriority.sort(
        (a, b) =>
          a.priority - b.priority ||
          (a.item.addedAt || 0) - (b.item.addedAt || 0),
      );
      return withPriority[0]?.item || null;
    }

    function handleQueueNext() {
      // считаем, что если нажали "Следующая", текущая in_progress завершена
      const queueBefore = loadQueue();
      let updated = false;
      queueBefore.forEach((item) => {
        if (item.status === "in_progress") {
          item.status = "done";
          updated = true;
        }
      });
      if (updated) saveQueue(queueBefore);

      const next = pickNext();
      if (!next) {
        Toast.show("Очередь пуста", "warn");
        return;
      }
      const ta = document.getElementById("nh-promos-tz");
      if (ta) ta.value = next.tz || "";
      State.setJson(STATE_LAST, next.parsed);
      buildPreview(next.parsed);
      next.status = "in_progress";
      const queue = loadQueue().map((q) => (q.id === next.id ? next : q));
      saveQueue(queue);
      renderQueue();
      applyToForm(next.parsed);
      Log.info("PROMOS", "Взята следующая акция из очереди", { id: next.id });
    }

    function handleQueueClear() {
      saveQueue([]);
      renderQueue();
      Toast.show("Очередь очищена", "info");
    }

    function handleAutopilotToggle(enabled) {
      State.setJson(STATE_AUTOPILOT, { enabled: !!enabled });
      Log.info("PROMOS", `Автопилот ${enabled ? "включен" : "выключен"}`);
      if (
        enabled &&
        Router.getContext() === "promo_edit" &&
        loadQueue().length
      ) {
        setTimeout(() => handleQueueNext(), 300);
      }
    }

    function init() {
      const stored = State.getJson(STATE_LAST, null);
      if (stored) buildPreview(stored);
      renderQueue();
      const auto = State.getJson(STATE_AUTOPILOT, { enabled: false });
      const autoEl = document.getElementById("nh-promos-autopilot");
      if (autoEl) autoEl.checked = !!auto.enabled;
      const queued = loadQueue();
      if (
        auto.enabled &&
        queued.length &&
        Router.getContext() === "promo_edit"
      ) {
        setTimeout(() => handleQueueNext(), 500);
      }
      Log.info("PROMOS", "Promos-модуль инициализирован");
    }

    return {
      init,
      handleParseClick,
      handleFillClick,
      handleQueueAdd,
      handleQueueNext,
      handleQueueClear,
      handleAutopilotToggle,
    };
  })();

  /******************************************************************
   * Bootstrap
   ******************************************************************/
  let booted = false;
  function bootstrap() {
    if (booted) return;
    booted = true;
    Core.Log.info("BOOT", `NAOS Super Helper v${SH.version} init`);
    Core.UI.init();
    SH.Modules.Blog.init();
    SH.Modules.Banners.init();
    SH.Modules.Promos.init();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
