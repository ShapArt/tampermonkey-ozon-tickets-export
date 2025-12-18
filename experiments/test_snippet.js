(async function () {
  const delay = (ms) => new Promise((res) => setTimeout(res, ms));

  // 1) Найдём первый тикет и его скроллящий контейнер
  const firstTicket = document.querySelector("div.index_chat_4fr82");
  if (!firstTicket) {
    console.error("Не найден ни один тикет");
    return;
  }
  // Поднимаемся вверх по DOM, пока не найдём overflow:auto или scroll
  let container = firstTicket.parentElement;
  while (
    container &&
    getComputedStyle(container).overflowY.match(/(auto|scroll)/) === null
  ) {
    container = container.parentElement;
  }
  if (!container) {
    console.error("Не нашли скроллящий контейнер");
    return;
  }

  // Парсер даты "DD.MM"
  function parseDM(raw) {
    const [d, m] = raw.split(".").map((x) => parseInt(x, 10));
    return { day: d, month: m };
  }
  const TH = { day: 20, month: 5 };

  // 2) Скроллим вниз, пока у последнего тикета дата > 20.05
  while (true) {
    const ticketsNow = Array.from(
      document.querySelectorAll("div.index_chat_4fr82"),
    );
    const last = ticketsNow[ticketsNow.length - 1];
    const raw = last
      .querySelector("span.index_chatDate_z4mNc")
      ?.textContent.trim();
    if (!raw) break;
    const { day, month } = parseDM(raw);
    // если дошли до нужной даты — прерываем
    if (month < TH.month || (month === TH.month && day <= TH.day)) {
      console.log(`Докачали до ${raw}`);
      break;
    }
    // иначе скроллим и ждём подгрузки
    container.scrollTop = container.scrollHeight;
    await delay(1000);
  }

  // 3) Собираем данные по всем тикетам, но остановимся на дате < 20.05
  const rows = [];
  for (let el of document.querySelectorAll("div.index_chat_4fr82")) {
    const raw =
      el.querySelector("span.index_chatDate_z4mNc")?.textContent.trim() || "";
    const { day, month } = parseDM(raw);
    if (month < TH.month || (month === TH.month && day < TH.day)) break;

    el.scrollIntoView({ block: "center" });
    el.click();
    await delay(1000);

    const num =
      el
        .querySelector("span.index_chatConversationId_jfC7p")
        ?.textContent.trim() || "";
    const msgDate =
      document.querySelector(".om_1_g0")?.textContent.trim() || "";
    const msgText =
      document.querySelector(".om_31_n6")?.textContent.trim() || "";

    rows.push({
      "Дата списка": raw,
      "№ обращения": num,
      "Дата сообщения": msgDate,
      "Текст сообщения": msgText,
    });
  }

  // 4) Выводим и скачиваем CSV
  console.table(rows);
  const header = [
    "Дата списка",
    "№ обращения",
    "Дата сообщения",
    "Текст сообщения",
  ];
  const csv = [
    header.join(","),
    ...rows.map((r) =>
      header.map((h) => `"${(r[h] || "").replace(/"/g, '""')}"`).join(","),
    ),
  ].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ozon_tickets_to_20may.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);

  console.log("✅ Экспорт завершён, скачан ozon_tickets_to_20may.csv");
})();
