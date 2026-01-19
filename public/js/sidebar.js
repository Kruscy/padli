const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay");
const toggle = document.getElementById("menuToggle");

// ha nincs sidebar vagy toggle, ne csináljunk semmit
if (!sidebar || !toggle || !overlay) {
  console.warn("Sidebar elements missing, sidebar disabled");
} else {

  function openSidebar() {
    sidebar.classList.add("open");
    overlay.classList.add("show");
  }

  function closeSidebar() {
    sidebar.classList.remove("open");
    overlay.classList.remove("show");
  }

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    sidebar.classList.contains("open")
      ? closeSidebar()
      : openSidebar();
  });

  overlay.addEventListener("click", closeSidebar);
}
