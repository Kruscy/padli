const container = document.getElementById("pollsContainer");
const createBtn = document.getElementById("createPollBtn");

(async function init() {
  const me = await fetch("/api/auth/me");
  if (me.ok) {
    const user = await me.json();
    if (user.role === "admin") {
      createBtn.classList.remove("hidden");
      createBtn.onclick = () => location.href = "/create-poll.html";
    }
  }

  loadPolls();
})();

async function loadPolls() {
  const res = await fetch("/api/polls");
  const polls = await res.json();

  container.innerHTML = "";

  for (const poll of polls) {
    renderPoll(poll.id);
  }
}

async function renderPoll(pollId) {
  const res = await fetch(`/api/polls/${pollId}`);
  const data = await res.json();

  const poll = data.poll;
  const options = data.options;
  const userVoteOptionId = data.userVoteOptionId;

  const totalVotes = options.reduce((a, b) => a + parseInt(b.votes), 0);

  const card = document.createElement("div");
  card.className = "poll-card";

  const title = document.createElement("div");
  title.className = "poll-title";
  title.textContent = poll.title;
  card.appendChild(title);

  const endsAt = new Date(poll.ends_at);
  const endsEl = document.createElement("div");
  endsEl.className = "poll-ends-at";
  endsEl.textContent = `Szavazás vége: ${endsAt.toLocaleDateString("hu-HU", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit"
  })}`;
  card.appendChild(endsEl);

  for (const option of options) {
    const div = document.createElement("div");
    div.className = "poll-option";
    if (option.id === userVoteOptionId) div.classList.add("voted");

    div.onclick = () => handleVote(poll.id, option.id, userVoteOptionId, card, pollId);

    const row = document.createElement("div");
    row.className = "option-row";

    if (option.image_url) {
      const img = document.createElement("img");
      img.src = option.image_url;
      row.appendChild(img);
    }

    const text = document.createElement("div");
    text.className = "option-text";
    text.textContent = option.title;
    row.appendChild(text);

    if (option.id === userVoteOptionId) {
      const badge = document.createElement("span");
      badge.className = "voted-badge";
      badge.textContent = "✔ Szavazatom";
      row.appendChild(badge);
    }

    div.appendChild(row);

    const percent = totalVotes ? Math.round((option.votes / totalVotes) * 100) : 0;

    const bar = document.createElement("div");
    bar.className = "progress-bar";

    const fill = document.createElement("div");
    fill.className = "progress-fill";
    fill.style.width = percent + "%";
    bar.appendChild(fill);

    div.appendChild(bar);
    card.appendChild(div);
  }

  container.appendChild(card);
}

async function handleVote(pollId, optionId, currentVoteOptionId, card, cardPollId) {
  if (optionId === currentVoteOptionId) return;

  if (currentVoteOptionId !== null) {
    const confirmed = confirm("Biztos át akarod tenni a szavazatodat?");
    if (!confirmed) return;

    const res = await fetch(`/api/polls/${pollId}/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionId, changeVote: true })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || "Hiba"); return; }
  } else {
    const res = await fetch(`/api/polls/${pollId}/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionId })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || "Hiba"); return; }
  }

  card.remove();
  renderPoll(cardPollId);
}
