(async function () {
  try {
    const res = await fetch("/api/new-releases");
    const items = await res.json();

    if (!items || items.length === 0) {
      document.getElementById("newReleasesCarousel").innerHTML =
        '<p style="text-align:center; color:#888; padding:40px;">Nincs új rész.</p>';
      return;
    }

    // Carousel items előkészítése
    const carouselItems = items.map(item => {
      return {
        title: item.title,
        cover_url: item.cover_url,
        link: `/chapters.html?slug=${encodeURIComponent(item.slug)}`,
        titleLink: `/chapters.html?slug=${encodeURIComponent(item.slug)}`,
        badge: `Új részek: +${item.new_count}`,  // ✅ BAL FELSŐ SAROKBAN
        badgeClass: 'new-count'
      };
    });

    // Carousel létrehozása
    const carousel = new Carousel('newReleasesCarousel', {
      itemsPerRow: 30,  // ✅ 30 manga egy sorban
      gap: 16,
      showMoreButton: items.length > 30  // ✅ "Több" gomb ha több mint 30
    });

    carousel.setItems(carouselItems);

  } catch (e) {
    console.error("Új részek hiba:", e);
  }
})();
