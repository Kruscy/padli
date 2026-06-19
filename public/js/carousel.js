/* ═══════════════════════════════════════════════════════════
   CAROUSEL COMPONENT - Momentum Scrolling
   Ha gyorsan húzod és elengeded → pörög tovább
   ═══════════════════════════════════════════════════════════ */

class Carousel {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.options = {
      itemsPerRow: options.itemsPerRow || 20,
      gap: options.gap || 16,
      showMoreButton: options.showMoreButton !== false,
      onShowMore: options.onShowMore || null,
      ...options
    };
    
    this.items = [];
    this.isExpanded = false;
    
    this.init();
  }
  
  init() {
    this.container.innerHTML = '';
    
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'carousel-wrapper';
    
    this.scrollContainer = document.createElement('div');
    this.scrollContainer.className = 'carousel-scroll';
    
    this.grid = document.createElement('div');
    this.grid.className = 'carousel-grid';
    this.grid.style.gap = `${this.options.gap}px`;
    
    this.scrollContainer.appendChild(this.grid);
    this.wrapper.appendChild(this.scrollContainer);
    
    if (this.options.showMoreButton) {
      this.moreButton = document.createElement('button');
      this.moreButton.className = 'carousel-more-btn';
      this.moreButton.innerHTML = '▼ Több';
      this.moreButton.onclick = () => this.toggleExpand();
      this.wrapper.appendChild(this.moreButton);
    }
    
    this.container.appendChild(this.wrapper);
    
    this.enableSwipe();
  }
  
  enableSwipe() {
    let startX = 0;
    let startY = 0;
    let scrollLeft = 0;
    let isDragging = false;
    let totalDistance = 0;
    
    // ✅ Momentum tracking
    let lastX = 0;
    let lastTime = 0;
    let velocityX = 0;
    
    const CLICK_THRESHOLD = 5;
    const MOMENTUM_MULTIPLIER = 0.5; // Erősség
    const FRICTION = 0.95; // Lassulás (minél közelebb 1-hez, annál tovább pörög)
    
    let momentumAnimation = null;
    
    const startDrag = (clientX, clientY) => {
      // Állítsd meg az előző momentum-ot
      if (momentumAnimation) {
        cancelAnimationFrame(momentumAnimation);
        momentumAnimation = null;
      }
      
      isDragging = true;
      totalDistance = 0;
      startX = clientX;
      startY = clientY;
      lastX = clientX;
      lastTime = Date.now();
      velocityX = 0;
      scrollLeft = this.scrollContainer.scrollLeft;
      this.scrollContainer.style.cursor = 'grabbing';
      this.scrollContainer.style.userSelect = 'none';
    };
    
    const stopDrag = () => {
      isDragging = false;
      this.scrollContainer.style.cursor = 'grab';
      this.scrollContainer.style.userSelect = '';
      
      // ✅ Ha van sebesség → momentum scroll
      if (Math.abs(velocityX) > 0.5) {
        applyMomentum();
      }
    };
    
    const doDrag = (clientX, clientY) => {
      if (!isDragging) return;
      
      const deltaX = clientX - startX;
      const deltaY = clientY - startY;
      
      totalDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      
      // ✅ Sebesség számítása
      const now = Date.now();
      const timeDelta = now - lastTime;
      
      if (timeDelta > 0) {
        const moveDelta = clientX - lastX;
        velocityX = moveDelta / timeDelta * 16; // Normalizálás 60fps-re
      }
      
      lastX = clientX;
      lastTime = now;
      
      this.scrollContainer.scrollLeft = scrollLeft - deltaX;
    };
    
    // ✅ Momentum scroll alkalmazása
    const applyMomentum = () => {
      if (Math.abs(velocityX) < 0.1) {
        velocityX = 0;
        momentumAnimation = null;
        return;
      }
      
      this.scrollContainer.scrollLeft -= velocityX * MOMENTUM_MULTIPLIER;
      velocityX *= FRICTION;
      
      momentumAnimation = requestAnimationFrame(applyMomentum);
    };
    
    // Mouse events
    this.scrollContainer.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      startDrag(e.clientX, e.clientY);
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      doDrag(e.clientX, e.clientY);
    });
    
    document.addEventListener('mouseup', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      stopDrag();
    });
    
    // Kattintás gátlása ha drag volt
    this.scrollContainer.addEventListener('click', (e) => {
      if (totalDistance > CLICK_THRESHOLD) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    }, true);
    
    // ✅ Újra nyomás közben állítsa meg a momentum-ot
    this.scrollContainer.addEventListener('mousedown', () => {
      if (momentumAnimation) {
        cancelAnimationFrame(momentumAnimation);
        momentumAnimation = null;
        velocityX = 0;
      }
    });
    
    // Touch events (ugyanaz a logika)
    let touchStartX = 0;
    let touchStartY = 0;
    let touchScrollLeft = 0;
    let touchDistance = 0;
    let touchLastX = 0;
    let touchLastTime = 0;
    let touchVelocityX = 0;
    let touchMomentumAnimation = null;
    
    this.scrollContainer.addEventListener('touchstart', (e) => {
      if (touchMomentumAnimation) {
        cancelAnimationFrame(touchMomentumAnimation);
        touchMomentumAnimation = null;
      }
      
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchLastX = touchStartX;
      touchLastTime = Date.now();
      touchScrollLeft = this.scrollContainer.scrollLeft;
      touchDistance = 0;
      touchVelocityX = 0;
    }, { passive: true });
    
    this.scrollContainer.addEventListener('touchmove', (e) => {
      const clientX = e.touches[0].clientX;
      const clientY = e.touches[0].clientY;
      const deltaX = touchStartX - clientX;
      const deltaY = touchStartY - clientY;
      
      touchDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      
      const now = Date.now();
      const timeDelta = now - touchLastTime;
      
      if (timeDelta > 0) {
        const moveDelta = clientX - touchLastX;
        touchVelocityX = moveDelta / timeDelta * 16;
      }
      
      touchLastX = clientX;
      touchLastTime = now;
      
      this.scrollContainer.scrollLeft = touchScrollLeft + deltaX;
    }, { passive: true });
    
    this.scrollContainer.addEventListener('touchend', (e) => {
      if (touchDistance > CLICK_THRESHOLD) {
        e.preventDefault();
        
        // Touch momentum
        if (Math.abs(touchVelocityX) > 0.5) {
          const applyTouchMomentum = () => {
            if (Math.abs(touchVelocityX) < 0.1) {
              touchVelocityX = 0;
              touchMomentumAnimation = null;
              return;
            }
            
            this.scrollContainer.scrollLeft -= touchVelocityX * MOMENTUM_MULTIPLIER;
            touchVelocityX *= FRICTION;
            
            touchMomentumAnimation = requestAnimationFrame(applyTouchMomentum);
          };
          
          applyTouchMomentum();
        }
      }
    });
  }
  
  setItems(items) {
    this.items = items;
    this.render();
  }
  
  render() {
    this.grid.innerHTML = '';
    
    const displayItems = this.isExpanded 
      ? this.items 
      : this.items.slice(0, this.options.itemsPerRow);
    
    displayItems.forEach(item => {
      const card = this.createCard(item);
      this.grid.appendChild(card);
    });
    
    if (this.isExpanded) {
      this.grid.classList.add('expanded');
      this.wrapper.classList.add('expanded');
      if (this.moreButton) {
        this.moreButton.innerHTML = '▲ Kevesebb';
      }
    } else {
      this.grid.classList.remove('expanded');
      this.wrapper.classList.remove('expanded');
      if (this.moreButton) {
        this.moreButton.innerHTML = `▼ Több (${this.items.length - this.options.itemsPerRow})`;
      }
    }
  }
  
  createCard(item) {
    const card = document.createElement('div');
    card.className = 'card';
    
    const coverLink = document.createElement('a');
    coverLink.className = 'cover';
    coverLink.href = item.link;
    
    coverLink.addEventListener('dragstart', (e) => e.preventDefault());
    
    if (item.cover_url) {
      const img = document.createElement('img');
      img.src = item.cover_url;
      img.loading = 'lazy';
      img.alt = item.title;
      img.draggable = false;
      img.addEventListener('dragstart', (e) => e.preventDefault());
      coverLink.appendChild(img);
    }
    
    if (item.badge) {
      const badge = document.createElement('div');
      badge.className = item.badgeClass || 'badge';
      badge.textContent = item.badge;
      coverLink.appendChild(badge);
    }
    
    const title = document.createElement('a');
    title.className = 'title';
    title.href = item.titleLink || item.link;
    title.textContent = item.title;
    
    card.appendChild(coverLink);
    card.appendChild(title);
    
    return card;
  }
  
  toggleExpand() {
    this.isExpanded = !this.isExpanded;
    this.render();
    
    if (this.options.onShowMore && this.isExpanded) {
      this.options.onShowMore();
    }
  }
}

window.Carousel = Carousel;
