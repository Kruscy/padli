(async function () {

  const container = document.getElementById("closedPolls");

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));

  const fmtDate = d => new Date(d).toLocaleDateString("hu-HU", {
    year: "numeric", month: "long", day: "numeric"
  });

  let polls;
  try {
    const res = await fetch("/api/polls/closed");
    if (!res.ok) throw new Error(res.status);
    polls = await res.json();
  } catch {
    container.innerHTML = `<p class="closed-empty">Nem sikerült betölteni a lezárt szavazásokat.</p>`;
    return;
  }

  if (!polls.length) {
    container.innerHTML = `<p class="closed-empty">Még nincs lezárt szavazás.</p>`;
    return;
  }

  // A backend már a legutóbb lezárttal kezdve küldi, de itt is biztosítjuk
  polls.sort((a, b) => new Date(b.ends_at) - new Date(a.ends_at) || b.id - a.id);

  for (const poll of polls) {

    const totalVotes = poll.options.reduce((a, b) => a + b.votes, 0);
    const maxVotes = Math.max(0, ...poll.options.map(o => o.votes));

    const optionsHtml = [...poll.options]
      .sort((a, b) => b.votes - a.votes)
      .map(opt => {

        const percent = totalVotes
          ? Math.round((opt.votes / totalVotes) * 100)
          : 0;
        const winner = maxVotes > 0 && opt.votes === maxVotes;

        return `
          <div class="result-row${winner ? " winner" : ""}">
            <div class="result-head">
              <div class="result-label">${winner ? "🏆 " : ""}${esc(opt.title)}</div>
              <div class="result-meta"><strong>${opt.votes}</strong> szavazat · ${percent}%</div>
            </div>
            <div class="result-bar">
              <div class="fill" style="width:${percent}%"></div>
            </div>
          </div>
        `;
      }).join("");

    const box = document.createElement("article");
    box.className = "closed-poll";
    box.innerHTML = `
      <header class="closed-poll-head">
        <h3>${esc(poll.title)}</h3>
        <div class="closed-poll-info">
          <span>👤 Indította: <strong>${esc(poll.created_by || "ismeretlen")}</strong></span>
          <span>📅 ${fmtDate(poll.created_at)} – ${fmtDate(poll.ends_at)}</span>
          <span>🗳️ <strong>${poll.voters}</strong> szavazó</span>
        </div>
      </header>
      ${optionsHtml}
    `;

    container.appendChild(box);
  }

})();
