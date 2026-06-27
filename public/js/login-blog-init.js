(async function () {
  const grid = document.getElementById("loginBlogGrid");
  const CAT_LABELS = { hir:"Hírek", ajanlo:"Ajánló", forditas:"Fordítás", kozosseg:"Közösség" };
  const CAT_ICONS  = { hir:"📰", ajanlo:"📚", forditas:"✍️", kozosseg:"💬" };
  try {
    const res = await fetch("/api/blog?limit=21");
    const posts = res.ok ? await res.json() : [];
    if (!posts.length) {
      grid.innerHTML = '<p style="color:#555;font-size:.88rem">Hamarosan érkeznek bejegyzések!</p>';
      return;
    }
    grid.innerHTML = "";
    posts.forEach(p => {
      const cat  = CAT_LABELS[p.category] || p.category || "";
      const icon = CAT_ICONS[p.category]  || "📝";
      const date = p.created_at
        ? new Date(p.created_at).toLocaleDateString("hu-HU", {year:"numeric",month:"long",day:"numeric"})
        : "";
      const a = document.createElement("a");
      a.className = "login-blog-card";
      a.href = `/blog/${p.slug}.html`;
      a.innerHTML = `
        ${p.cover_url
          ? `<img src="${p.cover_url}" class="login-blog-thumb" loading="lazy" alt="">`
          : `<div class="login-blog-thumb-ph">${icon}</div>`}
        <div class="login-blog-body">
          <span class="login-blog-cat">${cat}</span>
          <h3>${p.title||""}</h3>
          <p>${p.excerpt||""}</p>
          <div class="login-blog-meta">${date}</div>
        </div>
      `;
      grid.appendChild(a);
    });
  } catch {
    grid.innerHTML = '<p style="color:#555;font-size:.88rem">Nem sikerült betölteni.</p>';
  }
})();
