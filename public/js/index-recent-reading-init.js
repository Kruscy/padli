(async function () {
  try {
    const res = await fetch("/api/progress/recent-reading");
    const items = await res.json();

    if (!items || items.length === 0) {
      document.getElementById("recentReadingCarousel").innerHTML =
        '<p style="text-align:center; color:#888; padding:40px;">Nincs aktív olvasásod.</p>';
      return;
    }

    // Carousel items előkészítése
    const carouselItems = items.map(item => {
      // ÚJ rész van? → ÚJ részre mutasson (page=0)
      const targetChapter = item.hasNewChapter ? item.nextChapter : item.chapter;
      const targetPage = item.hasNewChapter ? 0 : item.page;

      return {
        title: item.title,
        cover_url: item.cover_url,
        link: `/reader.html?slug=${encodeURIComponent(item.slug)}&chapter=${encodeURIComponent(targetChapter)}&page=${targetPage}`,
        titleLink: `/chapters.html?slug=${encodeURIComponent(item.slug)}`,
        badge: '▶ Folytatás',  // ✅ MINDIG csak "Folytatás"
        badgeClass: 'continue-badge'
      };
    });

    // Carousel létrehozása - ✅ 20 MANGA
    const carousel = new Carousel('recentReadingCarousel', {
      itemsPerRow: items.length,
      gap: 16,
      showMoreButton: false
    });

    carousel.setItems(carouselItems);

  } catch (e) {
    console.error("Most olvasott hiba:", e);
    document.getElementById("recentReadingCarousel").innerHTML =
      '<p style="color:#ef4444;">Hiba történt a betöltés során.</p>';
  }
})();
