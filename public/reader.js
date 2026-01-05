const params = new URLSearchParams(location.search);
const manga = params.get("manga");

fetch(`/api/chapters/${manga}`)
  .then(r => r.json())
  .then(chapters => {
    const ch = chapters[0]; // MVP: első fejezet
    for (let i = 1; i <= 30; i++) {
      const img = document.createElement("img");
      img.src = `/images/${manga}/${ch.folder}/${String(i).padStart(3,"0")}.webp`;
      img.style.width = "100%";
      document.getElementById("pages").appendChild(img);
    }
  });
