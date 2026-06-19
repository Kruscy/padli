function loadMatomo() {
  var _paq = window._paq = window._paq || [];
  _paq.push(['trackPageView']);
  _paq.push(['enableLinkTracking']);
  (function() {
    var u = "//mamato.csimota.duckdns.org/";
    _paq.push(['setTrackerUrl', u + 'matomo.php']);
    _paq.push(['setSiteId', '1']);
    var d = document, g = d.createElement('script'), s = d.getElementsByTagName('script')[0];
    g.async = true; g.src = u + 'matomo.js'; s.parentNode.insertBefore(g, s);
  })();
}

function cookieAccept() {
  localStorage.setItem('cookieConsent', 'accepted');
  var banner = document.getElementById('cookieBanner');
  if (banner) banner.style.display = 'none';
  loadMatomo();
}

function cookieDecline() {
  localStorage.setItem('cookieConsent', 'declined');
  var banner = document.getElementById('cookieBanner');
  if (banner) banner.style.display = 'none';
}

function initCookieBanner() {
  var consent = localStorage.getItem('cookieConsent');
  if (consent === 'accepted') {
    loadMatomo();
    return;
  }
  if (!consent) {
    var banner = document.getElementById('cookieBanner');
    if (banner) banner.style.display = 'flex';
  }
  var acceptBtn = document.getElementById('cookieAcceptBtn');
  var declineBtn = document.getElementById('cookieDeclineBtn');
  if (acceptBtn) acceptBtn.addEventListener('click', cookieAccept);
  if (declineBtn) declineBtn.addEventListener('click', cookieDecline);
}

// Footer betöltése után fut le (footer.js hívja)
window.initCookieBanner = initCookieBanner;
