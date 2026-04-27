const form = document.getElementById("pollForm");
const optionsContainer = document.getElementById("optionsContainer");
const addBtn = document.getElementById("addOptionBtn");
const fillUnclaimedBtn = document.getElementById("fillUnclaimedBtn");
const fillMyPlannedBtn = document.getElementById("fillMyPlannedBtn");

let optionCount = 0;

/* ================= ADMIN CHECK ================= */

(async function checkAdmin() {
  const res = await fetch("/api/auth/me");
  if (!res.ok) return location.href = "/";

  const user = await res.json();
  if (user.role !== "admin") {
    location.href = "/";
  }
})();

/* ================= ADD OPTION ================= */

function addOption(title = "", image = "") {
  if (optionCount >= 10) return alert("Max 10 opció!");

  optionCount++;

  const div = document.createElement("div");
  div.className = "option-box";
  div.dataset.optionId = optionCount;

  div.innerHTML = `
    <button type="button" class="remove-option">✖</button>
    <input class="option-title" placeholder="Opció neve" value="${title}" required>
    <input class="option-image" placeholder="Kép URL (opcionális)" value="${image}">
  `;

  div.querySelector(".remove-option").onclick = () => {
    div.remove();
    optionCount--;
  };

  optionsContainer.appendChild(div);
}

/* Kezdő 2 opció */
addOption();
addOption();

addBtn.onclick = () => addOption();

/* ================= WISHLIST AUTO-FILL ================= */

// 🎲 Random nem claimbelt kívánságok
fillUnclaimedBtn.onclick = async () => {
  const existingOptions = document.querySelectorAll(".option-box");
  const count = existingOptions.length;

  try {
    const res = await fetch(`/api/wishlist/for-polls/unclaimed?limit=${count}`);
    
    if (!res.ok) {
      const error = await res.json();
      alert(error.error || "Hiba a kívánságok betöltésekor");
      return;
    }

    const items = await res.json();

    if (!items || items.length === 0) {
      alert("❌ Nincs nem claimbelt kívánság a listában!");
      return;
    }

    // Meglévő opciók kitöltése
    existingOptions.forEach((optionBox, index) => {
      const item = items[index];
      if (item) {
        const titleInput = optionBox.querySelector(".option-title");
        const imageInput = optionBox.querySelector(".option-image");

        titleInput.value = item.title || "";
        imageInput.value = item.cover_url || "";
      }
    });

    console.log(`✅ ${items.length} random kívánság betöltve`);
    alert(`✅ ${items.length} random kívánság betöltve!`);

  } catch (err) {
    console.error("Unclaimed wishlist load error:", err);
    alert("❌ Hiba a kívánságok betöltésekor: " + err.message);
  }
};

// 📋 Saját tervezett kívánságok
fillMyPlannedBtn.onclick = async () => {
  const existingOptions = document.querySelectorAll(".option-box");
  const count = existingOptions.length;

  try {
    const res = await fetch(`/api/wishlist/for-polls/my-planned?limit=${count}`);
    
    if (!res.ok) {
      const error = await res.json();
      alert(error.error || "Hiba a tervek betöltésekor");
      return;
    }

    const items = await res.json();

    if (!items || items.length === 0) {
      alert("❌ Nincs 'tervben van' státuszú kívánságod!");
      return;
    }

    // Meglévő opciók kitöltése
    existingOptions.forEach((optionBox, index) => {
      const item = items[index];
      if (item) {
        const titleInput = optionBox.querySelector(".option-title");
        const imageInput = optionBox.querySelector(".option-image");

        titleInput.value = item.title || "";
        imageInput.value = item.cover_url || "";
      }
    });

    console.log(`✅ ${items.length} saját terv betöltve`);
    alert(`✅ ${items.length} saját terved betöltve!`);

  } catch (err) {
    console.error("My planned wishlist load error:", err);
    alert("❌ Hiba a tervek betöltésekor: " + err.message);
  }
};

/* ================= SUBMIT ================= */

form.addEventListener("submit", async e => {
  e.preventDefault();

  const title = document.getElementById("pollTitle").value;
  const durationDays = parseInt(document.getElementById("duration").value);

  const options = [...document.querySelectorAll(".option-box")]
    .map(box => {
      const inputs = box.querySelectorAll("input");
      return {
        title: inputs[0].value,
        image_url: inputs[1].value || null
      };
    });

  if (options.length < 2) {
    return alert("Minimum 2 opció szükséges!");
  }

  const res = await fetch("/api/polls", {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ title, durationDays, options })
  });

  const data = await res.json();

  if (!res.ok) {
    alert(data.error || "Hiba");
    return;
  }

  alert("✅ Szavazás létrehozva!");
  location.href = "/polls.html";
});
