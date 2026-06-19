(async () => {
  const res = await fetch("/api/user/me");
  if (!res.ok) return;

  const data = await res.json();

  if (data.avatar) {
    document.getElementById("avatar").src = data.avatar;
  }
})();
