/* ============================================================
   monthly-invoice-report.mjs
   Minden hónap 1-én lefut (crontab) — az előző hónap Billingo
   számláiból generál egy /opt/<hónapnév>.xlsx riportot.
   ============================================================ */

import "dotenv/config";
import ExcelJS from "exceljs";

const HONAPNEVEK = [
  "január", "február", "március", "április", "május", "június",
  "július", "augusztus", "szeptember", "október", "november", "december",
];

async function fetchAllDocuments() {
  const apiKey = process.env.BILLINGO_API_KEY;
  if (!apiKey) throw new Error("BILLINGO_API_KEY nincs beállítva");

  let page = 1, lastPage = 1;
  const all = [];
  do {
    const res = await fetch(`https://api.billingo.hu/v3/documents?page=${page}&per_page=100`, {
      headers: { "X-API-KEY": apiKey },
    });
    if (!res.ok) throw new Error(`Billingo API hiba (${res.status})`);
    const data = await res.json();
    lastPage = data.last_page;
    all.push(...data.data);
    page++;
  } while (page <= lastPage);
  return all;
}

async function main() {
  const now = new Date();
  // Az előző hónapra generálunk riportot (1-jén futtatva ez a lezárt hónap)
  const targetDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = targetDate.getFullYear();
  const monthIdx = targetDate.getMonth(); // 0-11
  const monthName = HONAPNEVEK[monthIdx];
  const monthPrefix = `${year}-${String(monthIdx + 1).padStart(2, "0")}`;

  console.log(`[monthly-invoice-report] Riport generálása: ${monthName} (${monthPrefix})`);

  const all = await fetchAllDocuments();
  const rows = all
    .filter(d => d.invoice_date?.startsWith(monthPrefix) && !d.cancelled && d.correction_type !== "cancellation")
    .sort((a, b) => a.invoice_date.localeCompare(b.invoice_date) || a.invoice_number.localeCompare(b.invoice_number))
    .map((d, i) => ({
      nr: i + 1,
      invoice_number: d.invoice_number,
      invoice_date: d.invoice_date,
      partner_name: d.partner?.name || "",
      gross: d.summary?.gross_amount_local,
      vat: d.summary?.vat_amount_local,
      due_date: d.due_date,
      paid_date: d.paid_date,
    }));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`${year}. ${monthName}`);

  ws.columns = [
    { header: "Nr.", key: "nr", width: 6 },
    { header: "Bizonylat száma", key: "invoice_number", width: 18 },
    { header: "Számla kiállítás időpontja", key: "invoice_date", width: 22 },
    { header: "Partner", key: "partner_name", width: 26 },
    { header: "Bevétel összege", key: "gross", width: 16 },
    { header: "Felszámított ÁFA", key: "vat", width: 16 },
    { header: "Fizetési határidő", key: "due_date", width: 18 },
    { header: "Pü teljesítés időpontja", key: "paid_date", width: 20 },
    { header: "", key: "col9", width: 16 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: "middle", wrapText: true };
  rows.forEach(r => ws.addRow(r));
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const outPath = `/opt/szamlak/${monthName}.xlsx`;
  await wb.xlsx.writeFile(outPath);
  console.log(`[monthly-invoice-report] Kész: ${outPath} (${rows.length} számla)`);
}

main().catch(err => {
  console.error("[monthly-invoice-report] Hiba:", err);
  process.exit(1);
});
