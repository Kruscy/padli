// A képernyő bal / jobb nyila — az irányt (balról jobbra / jobbról balra) a
// reader.js bookArrow-ja dönti el
document.getElementById("bookPrev")?.addEventListener("click", () => window.bookArrow?.("left"));
document.getElementById("bookNext")?.addEventListener("click", () => window.bookArrow?.("right"));
