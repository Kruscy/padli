import express from "express";
import rateLimit from "express-rate-limit";
import { requireAdmin } from "../middleware/auth.js";

const router = express.Router();

const invoiceRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Túl sok próbálkozás, próbáld újra 1 perc múlva." },
});

const PATREON_PARTNER = {
  name: "Patreon, Inc.",
  emails: ["accountspayable@patreon.com"],
  send_email: true,
  taxcode: "46-3115122",
  address: {
    country_code: "US",
    post_code:    "94103",
    city:         "San Francisco, CA",
    address:      "600 Townsend Street, Suite 500",
  },
};

const BLOCK_ID = 321919;
const BASE     = "https://api.billingo.hu/v3";

async function billingoReq(method, path, body) {
  const apiKey = process.env.BILLINGO_API_KEY;
  if (!apiKey) throw new Error("BILLINGO_API_KEY nincs beállítva");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Billingo API hiba (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

async function findOrCreatePatreonPartner() {
  const search = await billingoReq("GET", `/partners?query=${encodeURIComponent("Patreon, Inc.")}`);
  if (search.data?.length) return search.data[0].id;

  const partner = await billingoReq("POST", "/partners", PATREON_PARTNER);
  return partner.id;
}

/* POST /api/patreon-invoice
   Body: { password, amount, description? }
   Csak admin + helyes jelszó esetén működik */
router.post("/", invoiceRateLimit, requireAdmin, async (req, res) => {
  const { password, amount, description } = req.body;

  if (!password || password !== process.env.SERVER_ADMIN_PASSWORD) {
    return res.status(403).json({ error: "Helytelen jelszó" });
  }

  const nettoAr = parseInt(amount, 10);
  if (!nettoAr || nettoAr < 1 || nettoAr > 10_000_000) {
    return res.status(400).json({ error: "Érvénytelen összeg" });
  }

  const itemName = (description || "IT-műszaki támogatás").trim().slice(0, 200);

  try {
    const partnerId = await findOrCreatePatreonPartner();
    const today     = new Date().toISOString().split("T")[0];

    const invoice = await billingoReq("POST", "/documents", {
      block_id:         BLOCK_ID,
      type:             "invoice",
      fulfillment_date: today,
      due_date:         today,
      payment_method:   "wire_transfer",
      electronic:       true,
      paid:             true,
      currency:         "HUF",
      language:         "hu",
      partner_id:       partnerId,
      items: [{
        name:            itemName,
        unit_price:      nettoAr,
        unit_price_type: "net",
        quantity:        1,
        unit:            "db",
        vat:             "HO",
      }],
      settings: { should_send_email: true },
    });

    console.log(`[PatreonInvoice] ✅ ${invoice.invoice_number} | ${nettoAr} Ft | ${itemName}`);
    res.json({ ok: true, invoiceNumber: invoice.invoice_number, invoiceId: invoice.id, amount: nettoAr });
  } catch (err) {
    console.error("[PatreonInvoice] ❌", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
