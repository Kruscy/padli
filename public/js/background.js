const desktopBackgrounds = [
  "/backgrounds/desktop/bg1.jpg",
  "/backgrounds/desktop/bg2.jpg",
  "/backgrounds/desktop/bg3.png"
];

const mobileBackgrounds = [
  "/backgrounds/mobile/bg1.jpg",
  "/backgrounds/mobile/bg2.jpg",
  "/backgrounds/mobile/bg3.jpg"
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const isMobile = window.matchMedia("(max-width: 768px)").matches;
const bg = isMobile
  ? pickRandom(mobileBackgrounds)
  : pickRandom(desktopBackgrounds);

document.getElementById("authPage").style.backgroundImage =
  `url('${bg}')`;
