/* ============================================================
   billingo.js — Billingo v3 számla kiállítás
   ============================================================ */

const BASE     = "https://api.billingo.hu/v3";
const BLOCK_ID = 321919;

async function req(method, path, body) {
  const apiKey = process.env.BILLINGO_API_KEY;
  if (!apiKey) throw new Error("BILLINGO_API_KEY nincs beállítva");

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Billingo API hiba (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

async function findOrCreatePartner(email, name) {
  // Először keresés email alapján
  const search = await req("GET", `/partners?query=${encodeURIComponent(email)}`);
  if (search.data?.length) return search.data[0].id;

  // Nincs partner → létrehozás
  const partner = await req("POST", "/partners", {
    name: name || email,
    emails: [email],
    send_email: true,
    address: {
      country_code: "HU",
      post_code: "0000",
      city: "Magyarország",
      address: "Online vásárlás",
    },
  });
  return partner.id;
}

/**
 * Számla kiállítás
 * @param {Object} opts
 * @param {string} opts.email    - Vásárló email
 * @param {string} opts.name     - Vásárló neve (opcionális, email fallback)
 * @param {Array}  opts.items    - [{ name, price, quantity? }]
 * @param {string} opts.paymentMethod - 'online_bankcard' | 'transfer' | 'cash'
 * @returns {number|null} invoice ID vagy null hiba esetén
 */
export async function createInvoice({ email, name, items, paymentMethod = "online_bankcard" }) {
  if (!process.env.BILLINGO_API_KEY) {
    console.warn("[Billingo] API kulcs hiányzik, számla kihagyva");
    return null;
  }

  try {
    const partnerId = await findOrCreatePartner(email, name);
    const today     = new Date().toISOString().split("T")[0];

    const invoice = await req("POST", "/documents", {
      block_id:         BLOCK_ID,
      type:             "invoice",
      fulfillment_date: today,
      due_date:         today,
      payment_method:   paymentMethod,
      electronic:       true,
      paid:             true,
      currency:         "HUF",
      language:         "hu",
      partner_id:       partnerId,
      items: items.map(item => ({
        name:            item.name,
        unit_price:      item.price,
        unit_price_type: "gross",
        quantity:        item.quantity || 1,
        unit:            "db",
        vat:             "AAM",
      })),
      settings: { should_send_emails: true },
    });

    console.log(`[Billingo] ✅ Számla kiállítva: ${invoice.invoice_number} (id: ${invoice.id})`);
    return invoice.id || null;
  } catch (err) {
    console.error("[Billingo] ❌ Hiba:", err.message);
    return null;
  }
}
