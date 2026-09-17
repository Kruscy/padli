(async function () {
  try {
    const adultMode = localStorage.getItem("adultMode") === "1";
    const res = await fetch(adultMode ? "/api/new-manga?adult=1" : "/api/new-manga");
    const items = await res.json();

    if (!items || items.length === 0) {
      document.getElementById("newMangaCarousel").innerHTML =
        '<p style="text-align:center; color:#888; padding:40px;">Nincs új manga.</p>';
      return;
    }

    const carouselItems = items.map(item => ({
      title: item.title,
      cover_url: item.cover_url,
      link: `/chapters.html?slug=${encodeURIComponent(item.slug)}`,
      titleLink: `/chapters.html?slug=${encodeURIComponent(item.slug)}`,
      badge: 'ÚJ',
      badgeClass: 'new-manga-badge'
    }));

    const carousel = new Carousel('newMangaCarousel', {
      itemsPerRow: 30,
      gap: 16,
      showMoreButton: false
    });

    carousel.setItems(carouselItems);

  } catch (e) {
    console.error("Új mangák hiba:", e);
  }
})();
