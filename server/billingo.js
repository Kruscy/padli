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

/**
 * Cím normalizálása Billingo formátumra.
 * Elfogad Stripe address objektumot ({ line1, line2, city, postal_code, country })
 * vagy egyetlen szöveges mezőt ("1234 Budapest, Fő utca 1.").
 */
function toBillingoAddress(input) {
  if (!input) {
    return { country_code: "HU", post_code: "0000", city: "Magyarország", address: "Online vásárlás" };
  }
  if (typeof input === "string") {
    // Szabad szöveges bevitel, nincs megbízható vessző-elválasztó — de a
    // Billingo megköveteli a város mezőt. A magyar településnevek szinte
    // mindig egy szóból állnak, ezért az irányítószám utáni első "szót"
    // (vessző/pont/szóköz határig) vesszük városnak, a maradék az utca.
    const mPost = input.match(/^\s*(\d{4})[,.\s]+(.*)$/s);
    if (mPost) {
      const rest = mPost[2];
      const mCity = rest.match(/^([^\s,.]+)[,.\s]*(.*)$/s);
      const city = mCity ? mCity[1] : rest.trim();
      const address = (mCity ? mCity[2].replace(/\s+/g, " ").trim() : "") || input;
      return { country_code: "HU", post_code: mPost[1], city, address };
    }
    return { country_code: "HU", post_code: "", city: "", address: input };
  }
  return {
    country_code: (input.country || "HU").toUpperCase(),
    post_code:    input.postal_code || "",
    city:         input.city || "",
    address:      [input.line1, input.line2].filter(Boolean).join(", "),
  };
}

async function findOrCreatePartner(email, name, address) {
  const billingoAddress = toBillingoAddress(address);

  // Először keresés email alapján
  const search = await req("GET", `/partners?query=${encodeURIComponent(email)}`);
  if (search.data?.length) {
    const partnerId = search.data[0].id;
    // Meglévő partner adatainak frissítése, ha most kaptunk valós nevet/címet
    if (address) {
      await req("PUT", `/partners/${partnerId}`, {
        name: name || email,
        emails: [email],
        address: billingoAddress,
      }).catch(err => console.warn("[Billingo] partner frissítés sikertelen:", err.message));
    }
    return partnerId;
  }

  // Nincs partner → létrehozás
  const partner = await req("POST", "/partners", {
    name: name || email,
    emails: [email],
    send_email: true,
    address: billingoAddress,
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
 * @param {Object|string} [opts.address] - Stripe address objektum vagy szöveges cím
 * @returns {number|null} invoice ID vagy null hiba esetén
 */
export async function createInvoice({ email, name, items, paymentMethod = "online_bankcard", address }) {
  if (!process.env.BILLINGO_API_KEY) {
    console.warn("[Billingo] API kulcs hiányzik, számla kihagyva");
    return null;
  }

  try {
    const partnerId = await findOrCreatePartner(email, name, address);
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
        vat:             "27%",
      })),
      settings: { should_send_email: true },
    });

    console.log(`[Billingo] ✅ Számla kiállítva: ${invoice.invoice_number} (id: ${invoice.id})`);
    return invoice.id || null;
  } catch (err) {
    console.error("[Billingo] ❌ Hiba:", err.message);
    return null;
  }
}
