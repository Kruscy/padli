(async function () {

  const container = document.getElementById("closedPolls");

  const res = await fetch("/api/polls/closed");
  const polls = await res.json();

  if (!polls.length) {
    container.innerHTML = "<p>Még nincs lezárt szavazás.</p>";
    return;
  }

  for (const poll of polls) {

    const totalVotes = poll.options.reduce((a, b) => a + b.votes, 0);

    const box = document.createElement("div");
    box.className = "closed-poll";

    const optionsHtml = poll.options
      .sort((a, b) => b.votes - a.votes)
      .map(opt => {

        const percent = totalVotes
          ? Math.round((opt.votes / totalVotes) * 100)
          : 0;

        return `
          <div class="result-row">
            <div class="result-label">${opt.title}</div>
            <div class="result-bar">
              <div class="fill" style="width:${percent}%"></div>
            </div>
            <div class="result-meta">
              ${opt.votes} szavazat (${percent}%)
            </div>
          </div>
        `;
      }).join("");

    box.innerHTML = `
      <h3>${poll.title}</h3>
      <p class="closed-date">
        Lezárva: ${new Date(poll.ends_at).toLocaleDateString()}
      </p>
      ${optionsHtml}
    `;

    container.appendChild(box);
  }

})();
