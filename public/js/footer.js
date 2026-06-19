var _ccScript = document.createElement('script');
_ccScript.src = '/js/cookie-consent.js';
_ccScript.onload = function() {
  fetch('/partials/footer.html')
    .then(res => res.text())
    .then(html => {
      document.getElementById('footer').innerHTML = html;
      if (typeof initCookieBanner === 'function') initCookieBanner();
    })
    .catch(err => console.error('Footer betöltési hiba:', err));
};
document.head.appendChild(_ccScript);
