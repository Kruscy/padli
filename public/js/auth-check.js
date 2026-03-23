window.currentUser = null;

async function loadUser() {
  try {
    const res = await fetch("/api/user/me", {
      credentials: "include"
    });

    if (!res.ok) {
      location.href = "/login.html";
      return;
    }

    const user = await res.json();
    console.log("USER:", user);

    window.currentUser = user;

    // ===== HEADER AVATAR =====
    const headerAvatar = document.getElementById("headerAvatar");
    if (headerAvatar) {
      headerAvatar.src = user.avatar + "?t=" + Date.now();
    }

    // ===== MENÜ AVATAR =====
    const menuAvatar = document.getElementById("menuAvatar");
    if (menuAvatar) {
      menuAvatar.src = user.avatar;
    }

    // ===== NÉV =====
    const nameEl = document.getElementById("menuUserName");
    if (nameEl) {
      nameEl.textContent = user.username;
    }

    // ===== TIER =====
    const tierEl = document.getElementById("menuUserTier");
    if (tierEl) {
      tierEl.textContent = user.tier;
    }

    // ===== AURA =====
    const wrapper = document.querySelector(".settings-wrapper");

    if (user.tier && wrapper) {
    const tierClass = user.tier
    .toLowerCase()
    .normalize("NFD") 
    .replace(/ã¡/g, "a")
    .replace(/ã³/g, "o")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-");

  wrapper.classList.add(tierClass);
}
  } catch (err) {
    console.error("AUTH ERROR:", err);
    location.href = "/login.html";
  }
}

// 🔥 EZ A LÉNYEG
function waitForHeader() {
  const interval = setInterval(() => {
    const headerAvatar = document.getElementById("headerAvatar");

    if (headerAvatar) {
      clearInterval(interval);
      loadUser(); // csak akkor fut amikor a header már létezik
    }
  }, 100);
}

waitForHeader();
document.dispatchEvent(new Event("layoutLoaded"));
