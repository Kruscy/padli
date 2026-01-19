(async () => {
  try {
    const res = await fetch("/api/auth/me", {
      credentials: "include"
    });

    if (!res.ok) {
      location.href = "/login.html";
    }
  } catch {
    location.href = "/login.html";
  }
})();
