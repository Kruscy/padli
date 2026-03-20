const form = document.getElementById("pollForm");
const optionsContainer = document.getElementById("optionsContainer");
const addBtn = document.getElementById("addOptionBtn");

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

  div.innerHTML = `
    <button type="button" class="remove-option">✖</button>
    <input placeholder="Opció neve" value="${title}" required>
    <input placeholder="Kép URL (opcionális)" value="${image}">
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

  alert("Szavazás létrehozva!");
  location.href = "/polls.html";
});
