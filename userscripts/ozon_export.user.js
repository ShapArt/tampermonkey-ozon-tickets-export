// ==UserScript==
// @name         Ozon Seller: Export Support Tickets
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Пробегает по всем обращениям и экспортирует дату, номер и текст твоего сообщения в CSV.
// @match        https://seller.ozon.ru/app/messenger/*
// @grant        none
// ==/UserScript==
(function () {
  "use strict";

  const delay = (ms) => new Promise((res) => setTimeout(res, ms));

  // Ждём, пока DOM загрузит список тикетов
  async function waitForTickets() {
    for (let i = 0; i < 30; i++) {
      const list = document.querySelector('[class*="ticketList"]');
      if (list && list.querySelectorAll('[class*="ticketItem"]').length) return;
      await delay(500);
    }
    console.warn("Tickets list not found.");
  }

  // Сбор селекторов
  function getTicketItems() {
    return Array.from(document.querySelectorAll('[class*="ticketItem"]'));
  }
  function getTicketDate(el) {
    return (
      el.querySelector('[class*="ticketItemDate"]')?.textContent.trim() || ""
    );
  }
  function getTicketTitle(el) {
    return (
      el.querySelector('[class*="ticketItemTitle"]')?.textContent.trim() || ""
    );
  }
  function extractNumber(title) {
    const m = title.match(/№\s*([\d]+)/);
    return m ? `№${m[1]}` : title;
  }
  function getUserMessages() {
    return Array.from(document.querySelectorAll('[class*="outgoingMessage"]'))
      .map((el) => el.textContent.trim().replace(/\n+/g, " "))
      .join(" | ");
  }

  // Генерация CSV и скачивание
  function downloadCSV(rows) {
    const header = ["Дата", "Номер обращения", "Моё сообщение"];
    const csv = [
      header.join(","),
      ...rows.map((r) =>
        [r.date, `"${r.number}"`, `"${r.text.replace(/"/g, '""')}"`].join(","),
      ),
    ].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ozon_tickets_export.csv";
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Основная функция сбора
  async function exportTickets() {
    const tickets = getTicketItems();
    const rows = [];

    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      ticket.scrollIntoView({ block: "center" });
      ticket.click();
      await delay(1200); // ждём, пока загрузится диалог

      const date = getTicketDate(ticket);
      const title = getTicketTitle(ticket);
      const number = extractNumber(title);
      const text = getUserMessages();

      rows.push({ date, number, text });
      console.log(`✔ [${i + 1}/${tickets.length}]`, date, number);
      await delay(300);
    }

    downloadCSV(rows);
  }

  // Вставляем кнопку в шапку
  async function initButton() {
    await waitForTickets();
    const header = document.querySelector('[class*="messengerHeader"]');
    if (!header) return console.warn("Header not found");

    const btn = document.createElement("button");
    btn.textContent = "📥 Export CSV";
    btn.style =
      "margin-left:10px;padding:4px 8px;background:#005bff;color:#fff;border:none;border-radius:4px;cursor:pointer;";
    btn.onclick = () => {
      btn.disabled = true;
      btn.textContent = "⏳ Exporting...";
      exportTickets().finally(() => {
        btn.disabled = false;
        btn.textContent = "📥 Export CSV";
      });
    };
    header.append(btn);
  }

  // Запуск
  window.addEventListener("load", initButton);
})();
