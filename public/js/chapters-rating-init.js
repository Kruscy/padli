(async () => {
  const slug = new URLSearchParams(location.search).get("slug");
  if (!slug) return;
  const widget = document.getElementById("ratingWidget");
  const infoBar = document.getElementById("mangaInfoBar");
  if (!widget || !infoBar) return;

  let userRating = 0, avgRating = null, ratingCount = 0, ratingBadge = null;

  try {
    const res = await fetch(`/api/rating/${slug}`);
    const data = await res.json();
    userRating = data.user_rating || 0;
    avgRating = data.avg_rating;
    ratingCount = data.rating_count || 0;
  } catch {}

  function hideVoter() { widget.style.display = "none"; }
  function showVoter() { widget.style.display = "flex"; }

  function renderBadge() {
    if (ratingBadge) ratingBadge.remove();
    if (!userRating) return;
    ratingBadge = document.createElement("span");
    ratingBadge.className = "manga-badge badge-rating";
    ratingBadge.title = "Kattints az értékelés módosításához";
    ratingBadge.innerHTML = `🍆 ${userRating}/10`;
    ratingBadge.addEventListener("click", () => widget.style.display === "none" ? showVoter() : hideVoter());
    infoBar.appendChild(ratingBadge);
  }

  function renderAvgBadge() {
    const old = document.getElementById("ratingAvgBadge");
    if (old) old.remove();
    if (!avgRating || !ratingCount) return;
    const avgBadge = document.createElement("span");
    avgBadge.id = "ratingAvgBadge";
    avgBadge.className = "manga-badge badge-rating";
    avgBadge.innerHTML = `${ratingCount} szavazat`;
    infoBar.appendChild(avgBadge);
  }

  function renderVoter() {
    widget.innerHTML = `
      <div class="eggplant-row" id="eggplantRow">
        ${Array.from({length:10},(_,i)=>`<span class="eggplant ${i<userRating?'active':''}" data-val="${i+1}">🍆</span>`).join("")}
      </div>
      <span class="rating-label" id="ratingLabel">${userRating ? `${userRating}/10` : "Értékeld!"}</span>
    `;
    const eggplants = widget.querySelectorAll(".eggplant");
    const label = document.getElementById("ratingLabel");
    eggplants.forEach(egg => {
      const val = parseInt(egg.dataset.val);
      egg.addEventListener("mouseenter", () => {
        label.textContent = `${val}/10`;
        eggplants.forEach((e,i) => { e.classList.toggle("hover",i<val); e.classList.remove("active"); });
      });
      egg.addEventListener("mouseleave", () => {
        label.textContent = userRating ? `${userRating}/10` : "Értékeld!";
        eggplants.forEach((e,i) => { e.classList.remove("hover"); e.classList.toggle("active",i<userRating); });
      });
      egg.addEventListener("click", async () => {
        const res = await fetch(`/api/rating/${slug}`, {
          method: "POST", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ rating: val })
        });
        const data = await res.json();
        if (data.ok) {
          userRating = data.user_rating; avgRating = data.avg_rating; ratingCount = data.rating_count;
          hideVoter(); renderBadge(); renderAvgBadge(); renderVoter();
        }
      });
    });
  }

  renderAvgBadge();
  renderVoter();
  if (userRating) { hideVoter(); renderBadge(); }
})();
