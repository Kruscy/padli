document.addEventListener("DOMContentLoaded", async () => {
  try {
    /* ===== ADMIN CHECK ===== */
    const meRes = await fetch("/api/auth/me");
    if (!meRes.ok) {
      location.replace("/index.html");
      return;
    }

    const me = await meRes.json();
    if (me.role !== "admin") {
      location.replace("/index.html");
      return;
    }

    document.body.classList.remove("hidden");

    /* ===== USERS LOAD ===== */
    const res = await fetch("/api/admin/users");
    if (!res.ok) {
      alert("Nem sikerült betölteni a felhasználókat");
      return;
    }

    const users = await res.json();
    renderUsers(users);

  } catch (err) {
    location.replace("/index.html");
  }
});

function renderUsers(users) {
  const tbody = document.getElementById("usersTableBody");
  tbody.innerHTML = "";

  users.forEach(u => {
    const tr = document.createElement("tr");

    const patreonActive = u.active === true;
    const patreonText = patreonActive ? "✅ Aktív" : "❌ Nincs";
    const tierText = u.tier ?? "-";

    tr.innerHTML = `
      <td>${u.id}</td>
      <td>${u.username}</td>
      <td>${u.email}</td>
      <td>
        <span class="role role-${u.role}">
          ${u.role}
        </span>
      </td>
      <td>
        <span class="patreon ${patreonActive ? "on" : "off"}">
          ${patreonText}
        </span>
      </td>
      <td>${tierText}</td>
      <td>${new Date(u.created_at).toLocaleDateString()}</td>
    `;

    tbody.appendChild(tr);
  });
}
