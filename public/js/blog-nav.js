(async function() {
  const nav = document.getElementById("blogNavRight");
  const home = Object.assign(document.createElement("a"), { href: "/", className: "nav-home-btn", textContent: "Főoldal" });
  nav.appendChild(home);
  try {
    const r = await fetch("/api/auth/me");
    if (r.ok) {
      const u = await r.json();
      const s = Object.assign(document.createElement("span"), { className: "nav-user-name", textContent: "👤 " + u.username });
      nav.insertBefore(s, home);
    } else throw 0;
  } catch {
    const btn = Object.assign(document.createElement("a"), { href: "/login.html", className: "nav-login-btn", textContent: "Bejelentkezés" });
    nav.insertBefore(btn, home);
  }
})();
