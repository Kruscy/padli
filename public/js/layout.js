const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay");
const toggle = document.getElementById("menuToggle");

toggle?.addEventListener("click", () => {
  sidebar.classList.toggle("open");
  overlay.classList.toggle("show");
});

overlay?.addEventListener("click", () => {
  sidebar.classList.remove("open");
  overlay.classList.remove("show");
});

<script>
const settingsBtn = document.getElementById("settingsBtn");
const settingsMenu = document.getElementById("settingsMenu");

settingsBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  settingsMenu.classList.toggle("hidden");
});

document.addEventListener("click", () => {
  settingsMenu?.classList.add("hidden");
});
</script>
