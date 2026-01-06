const params = new URLSearchParams(window.location.search);
const manga = params.get("manga");
const chapter = params.get("chapter");

const container = document.getElementById("pages");

if (!manga || !chapter) {
  container.innerHTML = "<p>Missing manga or chapter</p>";
  throw new Error("Missing params");
}

fetch(`/api/pages/${encodeURIComponent(manga)}/${encodeURIComponent(chapter)}`)
  .then((res) => res.json())
  .then((pages) => {
    pages.forEach((file) => {
      const img = document.createElement("img");
      img.src = `/images/${encodeURIComponent(manga)}/${encodeURIComponent(chapter)}/${encodeURIComponent(file)}`;
      img.style.width = "100%";
      img.style.display = "block";
      img.loading = "lazy";
      container.appendChild(img);
    });
  })
  .catch(() => {
    container.innerHTML = "<p>Error loading pages</p>";
  });
