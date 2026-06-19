(async function () {
  const res = await fetch("/api/stats/completion");
  const data = await res.json();

  const body = document.getElementById("statsBody");
  body.innerHTML = "";

  for (const row of data) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.title}</td>
      <td>${row.started}</td>
      <td>${row.completed}</td>
    `;
    body.appendChild(tr);
  }
})();
