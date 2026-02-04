const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay");
const toggle = document.getElementById("menuToggle");

function openSidebar() {
  sidebar.classList.add("open");
  overlay.classList.add("show");
}

function closeSidebar() {
  sidebar.classList.remove("open");
  overlay.classList.remove("show");
}

toggle?.addEventListener("click", () => {
  sidebar.classList.contains("open") ? closeSidebar() : openSidebar();
});

overlay?.addEventListener("click", closeSidebar);
