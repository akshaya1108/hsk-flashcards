/**
 * Main Application Controller for HSK Flashcards PWA
 */

const App = {
  activeTab: 'list', // 'list' | 'flashcard' | 'custom'
  selectedDeckId: 'all_words',
  includePreviousLevels: false,
  currentDeckWords: [],
  filteredDeckWords: [],
  searchQuery: '',
  renderLimit: 60, // Infinite scroll chunk size for fast rendering

  // Long-press & clipboard states
  longPressActive: false,
  ignoreNextClick: false,
  _toastTimer: null,

  initSplashScreen() {
    const splash = document.getElementById('app-splash');
    if (!splash) return;

    let dismissed = false;
    const dismissSplash = () => {
      if (dismissed) return;
      dismissed = true;
      splash.classList.add('splash-fade-out');

      // Seamlessly transition status bar, html, and body background to warm yellow (#FBDF98)
      try {
        document.documentElement.style.backgroundColor = '#FBDF98';
        document.body.style.backgroundColor = '#FBDF98';

        const splashStyle = document.getElementById('splash-theme-style');
        if (splashStyle) {
          splashStyle.textContent = 'html, body { background-color: #FBDF98 !important; }';
        }

        document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.remove());
        const meta = document.createElement('meta');
        meta.name = 'theme-color';
        meta.content = '#FBDF98';
        document.head.appendChild(meta);
      } catch (e) {
        console.warn('Error transitioning theme-color:', e);
      }

      setTimeout(() => {
        splash.style.display = 'none';
        if (splash.parentNode) splash.parentNode.removeChild(splash);
      }, 550);
    };

    // Show for 3 seconds, then smoothly fade out
    setTimeout(dismissSplash, 3000);

    // Also allow tapping anywhere to dismiss early
    splash.addEventListener('click', dismissSplash);
  },

  async init() {
    try {
      this.initSplashScreen();
      try {
        const savedInc = localStorage.getItem('hsk_include_prev_levels');
        if (savedInc !== null) {
          this.includePreviousLevels = (savedInc === 'true');
        }
      } catch (e) {}

      if (this.selectedDeckId && this.selectedDeckId.endsWith('_cum')) {
        this.includePreviousLevels = true;
        this.selectedDeckId = DeckManager.getBaseDeckId(this.selectedDeckId);
      }

      this.bindEvents();
      this.bindAlphabetScrubberEvents();
      this.renderTabs();
      this.renderDeckSelector();
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
          this.adjustDeckSelectWidth();
        });
      }
      if (window.SyncEngine) {
        SyncEngine.init();
        SyncEngine.onStatusChange((statusData) => this.updateCloudSyncStatus(statusData));
      }
      await Promise.all([
        DeckManager.loadPolyphones().catch(err => console.warn('Polyphones error:', err)),
        DeckManager.loadLevelIndex().catch(err => console.warn('Level index error:', err))
      ]);
      await this.loadDeck(this.selectedDeckId);
      this.registerServiceWorker();
    } catch (err) {
      console.error('App.init error:', err);
    }
  },

  async copyToClipboard(text) {
    if (!text) return false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {}
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '-9999px';
      ta.setAttribute('readonly', '');
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, 99999);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  },

  showToast(message) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.className = 'app-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');

    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.classList.remove('visible');
    }, 1800);
  },

  setupLongPressCopy(element, textGetter, label = 'Copied') {
    if (!element) return;
    let timer = null;
    let startX = 0;
    let startY = 0;
    let didTrigger = false;

    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    element.title = 'Long press to copy';

    element.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      didTrigger = false;
      startX = e.clientX;
      startY = e.clientY;

      clear();
      timer = setTimeout(async () => {
        didTrigger = true;
        this.longPressActive = true;
        const text = typeof textGetter === 'function' ? textGetter() : textGetter;
        if (text) {
          await this.copyToClipboard(text);
          this.showToast(`Copied ${label}: "${text}"`);
          try {
            if (navigator.vibrate) navigator.vibrate(40);
          } catch (err) {}

          element.classList.add('copy-pulse');
          setTimeout(() => element.classList.remove('copy-pulse'), 400);
        }
      }, 420);
    });

    element.addEventListener('pointermove', (e) => {
      if (!timer) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        clear();
      }
    });

    element.addEventListener('pointerup', (e) => {
      clear();
      if (didTrigger) {
        e.preventDefault();
        e.stopPropagation();
        this.ignoreNextClick = true;
        setTimeout(() => {
          this.ignoreNextClick = false;
          this.longPressActive = false;
        }, 350);
      }
    });

    element.addEventListener('pointercancel', () => {
      clear();
      if (didTrigger) {
        this.ignoreNextClick = true;
        setTimeout(() => {
          this.ignoreNextClick = false;
          this.longPressActive = false;
        }, 350);
      }
    });

    element.addEventListener('contextmenu', (e) => {
      if (didTrigger) {
        e.preventDefault();
      }
    });
  },

  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js?v=57').catch(err => {
        console.log('SW registration note:', err);
      });
    }
  },

  bindEvents() {
    // Prevent iOS Safari pinch-to-zoom
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('gesturechange', (e) => e.preventDefault());
    document.addEventListener('gestureend', (e) => e.preventDefault());

    // Prevent multi-touch pinch zoom
    document.addEventListener('touchstart', (e) => {
      if (e.touches.length > 1) {
        e.preventDefault();
      }
    }, { passive: false });

    // Prevent iOS double-tap zoom
    let lastTouchEnd = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) {
        e.preventDefault();
      }
      lastTouchEnd = now;
    }, { passive: false });

    // Tab switching & Words Home Button & Study Button
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = btn.dataset.tab;
        const setupModal = document.getElementById('study-setup-modal');
        const isSetupOpen = setupModal && setupModal.classList.contains('visible');
        if (isSetupOpen) {
          if (tab === 'study') return;
          setupModal.classList.remove('visible');
        }
        if (tab === 'list') {
          this.handleWordsHomeClick();
        } else if (tab === 'study') {
          this.onStudyButtonPressed();
        } else {
          this.switchTab(tab);
        }
      });
    });

    // Deck select changes in List View
    const deckSelect = document.getElementById('deck-select');
    if (deckSelect) {
      deckSelect.addEventListener('change', async (e) => {
        this.selectedDeckId = DeckManager.getBaseDeckId(e.target.value);
        this.renderDeckSelector();
        this.clearSearch(false);
        await this.loadDeck(this.selectedDeckId);
      });
    }

    // Cumulative level toggle in List View
    const listCumulativeToggle = document.getElementById('list-cumulative-toggle');
    if (listCumulativeToggle) {
      listCumulativeToggle.addEventListener('change', async (e) => {
        this.includePreviousLevels = e.target.checked;
        try {
          localStorage.setItem('hsk_include_prev_levels', this.includePreviousLevels ? 'true' : 'false');
        } catch (err) {}
        this.renderDeckSelector();
        await this.loadDeck(this.selectedDeckId);
      });
    }

    // Search input & clear button
    const searchInput = document.getElementById('search-input');
    const searchClearBtn = document.getElementById('btn-search-clear');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value;
        if (searchClearBtn) {
          searchClearBtn.style.display = this.searchQuery ? 'flex' : 'none';
        }
        this.filterAndRenderList();
      });
    }

    if (searchClearBtn) {
      searchClearBtn.addEventListener('click', () => {
        this.clearSearch(true);
        if (searchInput) searchInput.focus();
      });
    }

    // Infinite scroll & alphabet scroll-spy for list view (High performance)
    const listContainer = document.getElementById('list-container');
    if (listContainer) {
      let scrollTicking = false;
      listContainer.addEventListener('scroll', () => {
        if (!scrollTicking) {
          requestAnimationFrame(() => {
            this.updateActiveAlphabetLetterFromScroll();

            // Trigger chunk append 500px before reaching the bottom for seamless scrolling
            if (listContainer.scrollTop + listContainer.clientHeight >= listContainer.scrollHeight - 500) {
              this.appendNextChunk(60);
            }
            scrollTicking = false;
          });
          scrollTicking = true;
        }
      }, { passive: true });
    }

    // Flashcard Setup Trigger
    const startStudyBtn = document.getElementById('btn-start-study');
    if (startStudyBtn) {
      startStudyBtn.addEventListener('click', () => {
        this.onStudyButtonPressed();
      });
    }

    // Cloud Sync Dialog Trigger & Close Handlers
    const cloudSyncBtn = document.getElementById('btn-cloud-sync');
    if (cloudSyncBtn) {
      cloudSyncBtn.addEventListener('click', () => {
        this.openCloudSyncModal();
      });
    }

    const cloudSyncModal = document.getElementById('cloud-sync-modal');
    const closeCloudSyncBtn = document.getElementById('btn-close-sync-modal');
    if (closeCloudSyncBtn && cloudSyncModal) {
      closeCloudSyncBtn.addEventListener('click', () => {
        cloudSyncModal.classList.remove('visible');
      });
      cloudSyncModal.addEventListener('click', (e) => {
        if (e.target === cloudSyncModal) {
          cloudSyncModal.classList.remove('visible');
        }
      });
    }

    window.addEventListener('resize', () => {
      this.adjustDeckSelectWidth();
    });
  },

  switchTab(tab) {
    const prevTab = this.activeTab;
    this.activeTab = tab;
    const container = document.getElementById('app-container');
    if (container) {
      if (tab === 'flashcard') {
        container.classList.add('in-study');
      } else {
        container.classList.remove('in-study');
      }
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
      const bTab = btn.dataset.tab;
      const isActive = bTab === tab || (bTab === 'study' && tab === 'flashcard');
      btn.classList.toggle('active', isActive);
    });

    document.querySelectorAll('.tab-view').forEach(view => {
      view.classList.toggle('active', view.id === `view-${tab}`);
    });

    if (tab !== 'list') {
      this.clearSearch(false);
    }

    if (tab === 'custom') {
      this.renderCustomDecksView();
    } else if (tab === 'list') {
      if (prevTab === 'flashcard') {
        this.selectedDeckId = 'all_words';
      }
      const mainSelect = document.getElementById('deck-select');
      if (mainSelect) {
        mainSelect.value = this.selectedDeckId;
      }
      this.clearSearch(false);
      this.loadDeck(this.selectedDeckId);
    }
  },

  renderTabs() {
    const tabList = document.querySelector('.tab-btn[data-tab="list"]');
    const tabStudy = document.querySelector('.tab-btn[data-tab="study"]');
    const tabCustom = document.querySelector('.tab-btn[data-tab="custom"]');

    if (tabList) tabList.innerHTML = `${Icons.list(22)}<span>Words</span>`;
    if (tabStudy) tabStudy.innerHTML = `${Icons.cards(22)}<span>Study</span>`;
    if (tabCustom) tabCustom.innerHTML = `${Icons.star(22)}<span>Decks</span>`;
  },

  renderDeckOptionsHTML(selectedId) {
    const options = DeckManager.getBaseDeckOptions();
    const baseSelectedId = DeckManager.getBaseDeckId(selectedId);
    const groups = {};
    options.forEach(opt => {
      const grp = opt.group || 'Other';
      if (!groups[grp]) groups[grp] = [];
      groups[grp].push(opt);
    });

    return Object.keys(groups).map(grpName => {
      const opts = groups[grpName].map(opt => {
        const isSelected = (opt.id === baseSelectedId);
        return `<option value="${opt.id}" ${isSelected ? 'selected' : ''}>${opt.label}</option>`;
      }).join('');
      return `<optgroup label="${grpName}">${opts}</optgroup>`;
    }).join('');
  },

  updateListCumulativeToggleVisibility() {
    const toggleWrap = document.getElementById('list-cumulative-toggle-wrap');
    const toggleInput = document.getElementById('list-cumulative-toggle');
    if (!toggleWrap || !toggleInput) return;

    const baseId = DeckManager.getBaseDeckId(this.selectedDeckId);
    const isEligible = DeckManager.isCumulativeEligible(baseId);
    if (isEligible) {
      toggleWrap.style.display = 'flex';
      toggleInput.checked = Boolean(this.includePreviousLevels);
    } else {
      toggleWrap.style.display = 'none';
    }
  },

  adjustDeckSelectWidth() {
    const select = document.getElementById('deck-select');
    if (!select || !select.options || select.selectedIndex < 0) return;
    const selectedOption = select.options[select.selectedIndex];
    const selectedText = selectedOption ? selectedOption.text : '';
    if (!selectedText) return;

    const canvas = this._selectMeasureCanvas || (this._selectMeasureCanvas = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    ctx.font = '800 20px Manrope, -apple-system, sans-serif';
    const textWidth = Math.ceil(ctx.measureText(selectedText.toUpperCase()).width);
    select.style.width = `${textWidth + 20}px`;
  },

  renderDeckSelector() {
    const deckSelect = document.getElementById('deck-select');
    if (!deckSelect) return;
    const baseId = DeckManager.getBaseDeckId(this.selectedDeckId);
    deckSelect.innerHTML = this.renderDeckOptionsHTML(baseId, this.includePreviousLevels);
    deckSelect.value = baseId;
    this.updateListCumulativeToggleVisibility();
    this.adjustDeckSelectWidth();
  },

  async loadDeck(deckId) {
    const baseId = DeckManager.getBaseDeckId(deckId);
    this.selectedDeckId = baseId;
    const effectiveDeckId = DeckManager.getEffectiveDeckId(baseId, this.includePreviousLevels);

    this.clearSearch(false);
    this.showListLoading(true);
    this.renderLimit = 80;
    this.currentDeckWords = await DeckManager.getDeckWords(effectiveDeckId);
    this.showListLoading(false);

    // Update count badge
    const countBadge = document.getElementById('deck-count-badge');
    if (countBadge) {
      countBadge.textContent = `${this.currentDeckWords.length} words`;
    }

    this.filterAndRenderList();
    this.updateListCumulativeToggleVisibility();
    this.adjustDeckSelectWidth();
  },

  clearSearch(reRender = true) {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.value = '';
    }
    this.searchQuery = '';
    const searchClearBtn = document.getElementById('btn-search-clear');
    if (searchClearBtn) {
      searchClearBtn.style.display = 'none';
    }
    if (reRender) {
      this.filterAndRenderList();
    }
  },

  handleWordsHomeClick() {
    // 1. If not on list tab, switch to list tab
    if (this.activeTab !== 'list') {
      this.switchTab('list');
    }

    // Ensure tab buttons visually reflect the list tab
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === 'list');
    });

    // 2. Close any open modal
    document.querySelectorAll('.modal-overlay.visible').forEach(m => m.classList.remove('visible'));

    // 3. Clear search query if active
    const searchInput = document.getElementById('search-input');
    if (this.searchQuery || (searchInput && searchInput.value)) {
      this.clearSearch(false);
    }

    // 4. Default to master list with all words if currently on another deck
    if (this.selectedDeckId !== 'all_words') {
      this.selectedDeckId = 'all_words';
      const deckSelect = document.getElementById('deck-select');
      if (deckSelect) deckSelect.value = 'all_words';
      this.loadDeck('all_words');
    } else {
      this.filterAndRenderList();
    }

    // 5. Scroll smoothly to top (Home position)
    const listContainer = document.getElementById('list-container');
    if (listContainer) {
      listContainer.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    }

    this.updateActiveAlphabetLetterFromScroll();
  },

  // Tone-agnostic query normalizer (strips diacritics/tones, lowercase, maps ü/v to u, strips spaces & punctuation)
  normalizeSearchQuery(str) {
    if (!str) return '';
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // strip tone marks
      .toLowerCase()
      .replace(/ü/g, 'u')
      .replace(/v/g, 'u')
      .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')
      .trim();
  },

  async filterAndRenderList() {
    const rawQ = (this.searchQuery || '').trim();
    const countBadge = document.getElementById('deck-count-badge');
    const searchClearBtn = document.getElementById('btn-search-clear');

    if (!rawQ) {
      if (searchClearBtn) searchClearBtn.style.display = 'none';
      this.filteredDeckWords = [...this.currentDeckWords];

      if (countBadge) {
        countBadge.textContent = `${this.filteredDeckWords.length} words`;
      }

      this.buildLetterIndexMap();
      this.renderWordListInitial();
      this.renderAlphabetScrubber();
      return;
    }

    if (searchClearBtn) searchClearBtn.style.display = 'flex';

    const lowerQ = rawQ.toLowerCase();
    const normQ = this.normalizeSearchQuery(rawQ);
    const isPinyinQuery = /^[a-z0-9]+$/i.test(normQ);

    const queryToken = ++this._searchToken || (this._searchToken = 1);
    // Global Search: Search across entire vocabulary database
    const searchPool = await DeckManager.getGlobalSearchPool(this.selectedDeckId);

    // If query changed while loading, ignore this stale result
    if (queryToken !== this._searchToken) return;

    this.filteredDeckWords = searchPool.filter(w => {
      // 1. Hanzi match (e.g. 爱, 暗, 报名)
      if (w.hanzi && w.hanzi.includes(rawQ)) return true;

      // 2. English translation match (e.g. dark, sign up, train, love)
      if (w.meaning && w.meaning.toLowerCase().includes(lowerQ)) return true;

      // 3. Tone-agnostic Pinyin match (e.g. nihao, ni hao, xuexi, xue xi, baoming, chang, an, etc.)
      if (normQ && isPinyinQuery) {
        const normPy = this.normalizeSearchQuery(w.pinyin);
        const normSort = this.normalizeSearchQuery(w.pinyin_sort);
        if (normPy.includes(normQ) || normSort.includes(normQ)) return true;
      }

      // NOTE: Example sentences intentionally excluded so typing a character doesn't pull in hundreds of unrelated words
      return false;
    });

    if (countBadge) {
      countBadge.textContent = `${this.filteredDeckWords.length} found`;
    }

    this.buildLetterIndexMap();
    this.renderWordListInitial();
    this.renderAlphabetScrubber();
  },

  showListLoading(isLoading) {
    const listEl = document.getElementById('word-list');
    if (!listEl) return;
    if (isLoading) {
      listEl.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading vocabulary...</p></div>`;
    }
  },

  buildLetterIndexMap() {
    this.letterIndexMap = {};
    if (!this.filteredDeckWords) return;
    this.filteredDeckWords.forEach((w, idx) => {
      const fl = (w.pinyin_sort || DeckManager.normalizePinyin(w.pinyin) || '')[0]?.toUpperCase();
      if (fl && /^[A-Z]$/.test(fl) && this.letterIndexMap[fl] === undefined) {
        this.letterIndexMap[fl] = idx;
      }
    });
  },

  buildWordCardHTML(w) {
    const isRem = DeckManager.isRemembered(w.hanzi);
    const remIcon = isRem ? Icons.bookmarkFilled(16, '#E07A5F') : Icons.bookmark(16, '#8E8A83');
    const hanziLen = (w.hanzi || '').length;
    let sizeClass = 'size-xl';
    if (hanziLen === 2) sizeClass = 'size-lg';
    else if (hanziLen === 3) sizeClass = 'size-md';
    else if (hanziLen === 4) sizeClass = 'size-sm';
    else if (hanziLen >= 5) sizeClass = 'size-xs';

    const isPoly = DeckManager.getWordVersions(w, this.currentDeckWords).length > 1;
    const fl = (w.pinyin_sort || DeckManager.normalizePinyin(w.pinyin) || '')[0]?.toUpperCase() || '#';

    return `
      <div class="word-card-row" data-hanzi="${w.hanzi}" data-deck-index="${w.deckIndex}" data-letter="${fl}">
        <div class="word-card-left">
          <span class="word-card-index">#${w.deckIndex}</span>
          <span class="word-card-hanzi ${sizeClass}">${w.hanzi}</span>
        </div>
        <div class="word-card-right">
          <div class="word-card-pinyin-row">
            <span class="word-card-pinyin">${w.pinyin}</span>
            ${isPoly ? `<span class="poly-badge" title="Multiple readings">多音</span>` : ''}
          </div>
          <div class="word-card-meaning">${w.meaning || ''}</div>
          <div class="word-card-bottom-row">
            ${w.level ? `<span class="word-level-pill">HSK ${w.level}</span>` : ''}
            <button class="btn-card-action btn-speak" data-hanzi="${w.hanzi}" title="Listen" aria-label="Listen">
              ${Icons.speaker(16, '#52A1B1')}
            </button>
            <button class="btn-card-action btn-remember ${isRem ? 'active' : ''}" data-hanzi="${w.hanzi}" title="Bookmark" aria-label="Bookmark">
              ${remIcon}
            </button>
          </div>
        </div>
      </div>
    `;
  },

  buildChunkHTML(wordsSlice) {
    const htmlChunks = [];
    for (const w of wordsSlice) {
      const fl = (w.pinyin_sort || DeckManager.normalizePinyin(w.pinyin) || '')[0]?.toUpperCase() || '#';
      if (fl !== this._lastRenderedLetter && /^[A-Z]$/.test(fl)) {
        this._lastRenderedLetter = fl;
        htmlChunks.push(`
          <div class="letter-section-header" id="sec-letter-${fl}" data-letter="${fl}">
            <span class="letter-badge">${fl}</span>
            <div class="letter-line"></div>
          </div>
        `);
      }
      htmlChunks.push(this.buildWordCardHTML(w));
    }
    return htmlChunks.join('');
  },

  renderWordListInitial() {
    const listEl = document.getElementById('word-list');
    const listContainer = document.getElementById('list-container');
    if (!listEl) return;

    if (listContainer) {
      listContainer.scrollTop = 0;
    }

    if (!this.filteredDeckWords || this.filteredDeckWords.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">${Icons.search(36, '#A39E93')}</div>
          <p class="empty-title">No words found</p>
          <p class="empty-subtitle">No matching words found in the vocabulary database.</p>
        </div>
      `;
      this.renderedCount = 0;
      this._lastRenderedLetter = '';
      return;
    }

    this._lastRenderedLetter = '';
    const initialCount = Math.min(60, this.filteredDeckWords.length);
    const initialSlice = this.filteredDeckWords.slice(0, initialCount);
    listEl.innerHTML = this.buildChunkHTML(initialSlice);
    this.renderedCount = initialCount;

    // Attach high-performance delegated listeners once to container
    this.setupListEventDelegation();
  },

  appendNextChunk(count = 60) {
    if (this._isLoadingChunk) return;
    if (!this.filteredDeckWords || this.renderedCount >= this.filteredDeckWords.length) return;

    this._isLoadingChunk = true;
    const listEl = document.getElementById('word-list');
    if (!listEl) {
      this._isLoadingChunk = false;
      return;
    }

    const nextSlice = this.filteredDeckWords.slice(this.renderedCount, this.renderedCount + count);
    if (nextSlice.length > 0) {
      const chunkHTML = this.buildChunkHTML(nextSlice);
      listEl.insertAdjacentHTML('beforeend', chunkHTML);
      this.renderedCount += nextSlice.length;
    }
    this._isLoadingChunk = false;
  },

  renderWordListItems(resetScroll = false) {
    if (resetScroll) {
      this.renderWordListInitial();
    } else {
      this.appendNextChunk(60);
    }
  },

  setupListEventDelegation() {
    const listEl = document.getElementById('word-list');
    if (!listEl || listEl._delegationAttached) return;
    listEl._delegationAttached = true;

    // 1. Delegated Click Listener (Zero per-item listeners)
    listEl.addEventListener('click', (e) => {
      if (this.ignoreNextClick) {
        this.ignoreNextClick = false;
        return;
      }

      // Audio speak button click
      const speakBtn = e.target.closest('.btn-speak');
      if (speakBtn) {
        e.stopPropagation();
        const hanzi = speakBtn.dataset.hanzi;
        if (hanzi) ChineseSpeech.speak(hanzi);
        return;
      }

      // Remember button click
      const remBtn = e.target.closest('.btn-remember');
      if (remBtn) {
        e.stopPropagation();
        const hanzi = remBtn.dataset.hanzi;
        const word = (this.filteredDeckWords || []).find(w => w.hanzi === hanzi) ||
                     (this.currentDeckWords || []).find(w => w.hanzi === hanzi);
        if (word) {
          const isRem = DeckManager.toggleRemember(word);
          remBtn.innerHTML = isRem ? Icons.bookmarkFilled(16, '#E07A5F') : Icons.bookmark(16, '#8E8A83');
          remBtn.classList.toggle('active', isRem);
        }
        return;
      }

      // Word Card Row Click -> Open Word Detail Modal
      const row = e.target.closest('.word-card-row');
      if (row) {
        const deckIndex = parseInt(row.dataset.deckIndex, 10);
        const hanzi = row.dataset.hanzi;
        const word = (this.filteredDeckWords || []).find(w => w.deckIndex === deckIndex && w.hanzi === hanzi) ||
                     (this.filteredDeckWords || []).find(w => w.hanzi === hanzi) ||
                     (this.currentDeckWords || []).find(w => w.hanzi === hanzi);
        if (word) {
          this.openWordDetailModal(word);
        }
      }
    });

    // 2. Delegated Long-Press Auto-Copy
    let lpTimer = null;
    let lpStartX = 0;
    let lpStartY = 0;
    let lpTarget = null;

    const clearLp = () => {
      if (lpTimer) {
        clearTimeout(lpTimer);
        lpTimer = null;
      }
      lpTarget = null;
    };

    listEl.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      const hzTarget = e.target.closest('.word-card-hanzi');
      const pyTarget = e.target.closest('.word-card-pinyin');
      if (!hzTarget && !pyTarget) return;

      clearLp();
      lpStartX = e.clientX;
      lpStartY = e.clientY;
      const isHz = !!hzTarget;
      lpTarget = isHz ? hzTarget : pyTarget;
      const row = lpTarget.closest('.word-card-row');
      const text = isHz ? (row?.dataset.hanzi || lpTarget.textContent.trim()) : lpTarget.textContent.trim();
      const label = isHz ? 'character' : 'pinyin';

      lpTimer = setTimeout(async () => {
        this.longPressActive = true;
        this.ignoreNextClick = true;
        if (text) {
          await this.copyToClipboard(text);
          this.showToast(`Copied ${label}: "${text}"`);
          try {
            if (navigator.vibrate) navigator.vibrate(40);
          } catch (_) {}
          lpTarget.classList.add('copy-pulse');
          setTimeout(() => lpTarget && lpTarget.classList.remove('copy-pulse'), 400);
        }
      }, 420);
    });

    listEl.addEventListener('pointermove', (e) => {
      if (!lpTimer) return;
      if (Math.abs(e.clientX - lpStartX) > 8 || Math.abs(e.clientY - lpStartY) > 8) {
        clearLp();
      }
    });

    listEl.addEventListener('pointerup', () => {
      clearLp();
      setTimeout(() => { this.longPressActive = false; }, 50);
    });

    listEl.addEventListener('pointercancel', clearLp);
  },

  // --- Alphabet Scroller & Scrub Rail Controller ---
  renderAlphabetScrubber() {
    const scrubber = document.getElementById('alphabet-scrubber');
    if (!scrubber) return;

    if (!this.filteredDeckWords || this.filteredDeckWords.length === 0) {
      scrubber.style.display = 'none';
      return;
    }
    scrubber.style.display = 'flex';

    const availableLetters = new Set(Object.keys(this.letterIndexMap || {}));
    const standardAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const lettersToRender = standardAlphabet.filter(l => !['I', 'U', 'V'].includes(l) || availableLetters.has(l));

    scrubber.innerHTML = lettersToRender.map(l => {
      const hasWords = availableLetters.has(l);
      return `<button class="alpha-letter-btn ${hasWords ? '' : 'disabled'}" data-letter="${l}" ${hasWords ? '' : 'tabindex="-1" aria-disabled="true"'}>${l}</button>`;
    }).join('');

    this.updateActiveAlphabetLetterFromScroll();
  },

  bindAlphabetScrubberEvents() {
    const scrubber = document.getElementById('alphabet-scrubber');
    const bubble = document.getElementById('alphabet-bubble');
    if (!scrubber || !bubble) return;

    let isScrubbing = false;
    let lastScrubbedLetter = '';
    let scrubRaf = null;

    const getBtnFromY = (clientY) => {
      const btns = Array.from(scrubber.querySelectorAll('.alpha-letter-btn:not(.disabled)'));
      if (!btns.length) return null;

      let closestBtn = btns[0];
      let minDist = Infinity;

      for (const btn of btns) {
        const rect = btn.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const dist = Math.abs(clientY - midY);
        if (dist < minDist) {
          minDist = dist;
          closestBtn = btn;
        }
      }
      return closestBtn;
    };

    const handleScrub = (clientY) => {
      const btn = getBtnFromY(clientY);
      if (!btn) return;

      const letter = btn.dataset.letter;
      const rect = btn.getBoundingClientRect();
      const parentRect = scrubber.parentElement.getBoundingClientRect();

      // Position bubble aligned vertically with touch point (instant visual feedback)
      const relativeY = rect.top + rect.height / 2 - parentRect.top;
      bubble.style.top = `${relativeY}px`;
      bubble.textContent = letter;
      bubble.classList.add('visible');

      // Only perform scroll jumping when letter actually changes, throttled via RAF
      if (letter !== lastScrubbedLetter) {
        lastScrubbedLetter = letter;
        this.setActiveAlphabetLetter(letter);

        if (scrubRaf) cancelAnimationFrame(scrubRaf);
        scrubRaf = requestAnimationFrame(() => {
          this.scrollToLetter(letter, false);
        });
      }
    };

    scrubber.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      isScrubbing = true;
      scrubber.setPointerCapture(e.pointerId);
      handleScrub(e.clientY);
    });

    scrubber.addEventListener('pointermove', (e) => {
      if (!isScrubbing) return;
      e.preventDefault();
      handleScrub(e.clientY);
    });

    const onPointerEnd = () => {
      if (!isScrubbing) return;
      isScrubbing = false;
      lastScrubbedLetter = '';
      if (scrubRaf) cancelAnimationFrame(scrubRaf);
      setTimeout(() => {
        bubble.classList.remove('visible');
      }, 200);
    };

    scrubber.addEventListener('pointerup', onPointerEnd);
    scrubber.addEventListener('pointercancel', onPointerEnd);
  },

  scrollToLetter(letter, smooth = false) {
    if (!letter) return;
    const upperL = letter.toUpperCase();
    const targetIdx = this.letterIndexMap ? this.letterIndexMap[upperL] : -1;
    if (targetIdx === undefined || targetIdx < 0) return;

    const listContainer = document.getElementById('list-container');
    if (!listContainer) return;

    // Expand rendered items if target letter is beyond current DOM rendered count
    if (this.renderedCount <= targetIdx) {
      const needCount = (targetIdx - this.renderedCount) + 60;
      this.appendNextChunk(needCount);
    }

    const secEl = document.getElementById(`sec-letter-${upperL}`);
    if (secEl) {
      const containerRect = listContainer.getBoundingClientRect();
      const secRect = secEl.getBoundingClientRect();
      const offset = secRect.top - containerRect.top + listContainer.scrollTop - 6;
      listContainer.scrollTo({
        top: Math.max(0, offset),
        behavior: smooth ? 'smooth' : 'auto'
      });
    }
    this._lastActiveScrolledLetter = upperL;
    this.setActiveAlphabetLetter(upperL);
  },

  setActiveAlphabetLetter(letter) {
    const scrubber = document.getElementById('alphabet-scrubber');
    if (!scrubber || !letter) return;
    scrubber.querySelectorAll('.alpha-letter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.letter === letter);
    });
  },

  updateActiveAlphabetLetterFromScroll() {
    const listContainer = document.getElementById('list-container');
    if (!listContainer || !this.filteredDeckWords || !this.filteredDeckWords.length) return;

    // 1. Scrolled at or near top -> First letter
    if (listContainer.scrollTop <= 15) {
      const firstWord = this.filteredDeckWords[0];
      const fl = (firstWord?.pinyin_sort || DeckManager.normalizePinyin(firstWord?.pinyin) || '')[0]?.toUpperCase();
      if (fl && fl !== this._lastActiveScrolledLetter && /^[A-Z]$/.test(fl)) {
        this._lastActiveScrolledLetter = fl;
        this.setActiveAlphabetLetter(fl);
      }
      return;
    }

    // 2. Scrolled at or near bottom -> Last letter of loaded items
    if (listContainer.scrollTop + listContainer.clientHeight >= listContainer.scrollHeight - 15) {
      const lastWord = this.filteredDeckWords[this.renderedCount - 1] || this.filteredDeckWords[this.filteredDeckWords.length - 1];
      const fl = (lastWord?.pinyin_sort || DeckManager.normalizePinyin(lastWord?.pinyin) || '')[0]?.toUpperCase();
      if (fl && fl !== this._lastActiveScrolledLetter && /^[A-Z]$/.test(fl)) {
        this._lastActiveScrolledLetter = fl;
        this.setActiveAlphabetLetter(fl);
      }
      return;
    }

    // 3. Exact visual detection: inspect the visible card currently at the top of viewport
    const rect = listContainer.getBoundingClientRect();
    const probeX = rect.left + 50; // Inside card area, away from right-side scrubber rail
    const yOffsets = [70, 110, 40, 150];
    let detectedLetter = null;

    for (const dy of yOffsets) {
      const probeY = rect.top + dy;
      if (probeY < 0 || probeY > window.innerHeight) continue;
      const hit = document.elementFromPoint(probeX, probeY);
      const target = hit?.closest('[data-letter]');
      if (target && target.dataset.letter && /^[A-Z]$/.test(target.dataset.letter)) {
        detectedLetter = target.dataset.letter;
        break;
      }
    }

    if (detectedLetter && detectedLetter !== this._lastActiveScrolledLetter) {
      this._lastActiveScrolledLetter = detectedLetter;
      this.setActiveAlphabetLetter(detectedLetter);
    }
  },

  // Open Word Detail Modal (Clean Centered Floating Card with Card Navigation & Bottom Polyphones)
  openWordDetailModal(initialWord) {
    const modal = document.getElementById('word-detail-modal');
    if (!modal) return;

    const wordsList = (this.filteredDeckWords && this.filteredDeckWords.length > 0)
      ? this.filteredDeckWords
      : (this.currentDeckWords || []);

    let currentWordIdx = wordsList.findIndex(w => 
      (w.deckIndex !== undefined && initialWord.deckIndex !== undefined && w.deckIndex === initialWord.deckIndex && w.hanzi === initialWord.hanzi) ||
      (w.hanzi === initialWord.hanzi && (w.pinyin || '').toLowerCase() === (initialWord.pinyin || '').toLowerCase()) ||
      w.hanzi === initialWord.hanzi
    );
    if (currentWordIdx < 0) currentWordIdx = 0;

    const stage = modal.querySelector('#modal-card-stage');
    const btnPrev = modal.querySelector('#btn-modal-prev');
    const btnNext = modal.querySelector('#btn-modal-next');
    if (!stage) return;

    const buildCardHtml = (w, versions, activeIdx) => {
      const isRem = DeckManager.isRemembered(w.hanzi);
      if (!w.pos && DeckManager.globalSearchPool) {
        const cleanPy = DeckManager.cleanPinyin(w.pinyin || '');
        const match = DeckManager.globalSearchPool.find(m => m.hanzi === w.hanzi && (cleanPy ? DeckManager.cleanPinyin(m.pinyin || '') === cleanPy : true)) ||
                      DeckManager.globalSearchPool.find(m => m.hanzi === w.hanzi);
        if (match && match.pos) w.pos = match.pos;
      }

      // Compact, uniform curriculum level badges (e.g. 3.0 4级 and 2.0 6级)
      const hskInfo = DeckManager.getWordHskLevels(w.hanzi);
      let levelBadgesHTML = '';
      if (hskInfo) {
        if (hskInfo.hsk3 && hskInfo.hsk2 && hskInfo.hsk3 !== hskInfo.hsk2) {
          levelBadgesHTML = `
            <span class="detail-level-badge level-badge-hsk3" title="HSK 3.0 Band ${hskInfo.hsk3}">3.0-${hskInfo.hsk3}级</span>
            <span class="detail-level-badge level-badge-hsk2" title="HSK 2.0 Level ${hskInfo.hsk2}">2.0-${hskInfo.hsk2}级</span>
          `;
        } else if (hskInfo.hsk3) {
          levelBadgesHTML = `<span class="detail-level-badge level-badge-hsk3" title="HSK 3.0 Band ${hskInfo.hsk3}">3.0-${hskInfo.hsk3}级</span>`;
        } else if (hskInfo.hsk2) {
          levelBadgesHTML = `<span class="detail-level-badge level-badge-hsk2" title="HSK 2.0 Level ${hskInfo.hsk2}">2.0-${hskInfo.hsk2}级</span>`;
        }
      } else if (w.level) {
        levelBadgesHTML = `<span class="detail-level-badge level-badge-hsk3" title="HSK Level ${w.level}">3.0-${w.level}级</span>`;
      }

      return `
        <div class="card-header-bar">
          <div class="card-header-meta">
            <span class="detail-index-pill">#${w.deckIndex || w.id}</span>
            ${levelBadgesHTML}
          </div>
          <div class="card-header-actions">
            <button class="btn-icon btn-card-add-custom" id="btn-card-add-custom" title="Add to Custom Deck">
              ${Icons.plus(18)}
            </button>
            <button class="btn-icon btn-modal-remember ${isRem ? 'active' : ''}" title="Bookmark">
              ${isRem ? Icons.bookmarkFilled(19, '#E07A5F') : Icons.bookmark(19, '#A39E93')}
            </button>
            <button class="btn-icon btn-modal-close" title="Close">${Icons.close(19)}</button>
          </div>

          <!-- Floating Popover for Custom Decks -->
          <div class="custom-deck-popover" id="card-deck-popover"></div>
        </div>

        <div class="card-scroll-body" id="modal-card-scroll-body">
          <div class="card-main-display">
            <h1 class="card-large-hanzi">${w.hanzi}</h1>
            <div class="card-pinyin-block">
              <span class="card-pinyin-text">${w.pinyin}</span>
              <button class="btn-speaker-round" id="btn-detail-speak" title="Listen" aria-label="Listen">
                ${Icons.speaker(17, '#52A1B1')}
              </button>
            </div>
          </div>

          <!-- 1. Meaning Block -->
          <div class="card-meaning-block">
            <label class="card-meaning-label">Meaning${w.pos ? ` • <span class="card-pos-tag">${w.pos.toUpperCase()}</span>` : ''}</label>
            <p class="card-meaning-text">${w.meaning || 'No translation available'}</p>
          </div>

          <!-- 2. Example Sentence Block -->
          ${w.example ? `
            <div class="card-example-block">
              <div class="example-top">
                <label class="card-ex-label">Example Sentence</label>
                <button class="btn-icon-tiny" id="btn-example-speak" title="Listen Sentence">
                  ${Icons.speaker(14, '#52A1B1')}
                </button>
              </div>
              <div class="card-example-card">
                <p class="ex-zh">${w.example.zh}</p>
                <p class="ex-py">${w.example.py}</p>
                <p class="ex-en">${w.example.en}</p>
              </div>
            </div>
          ` : ''}

          <!-- 3. Other Readings Polyphone Block (Moved to bottom below Example Sentence) -->
          ${versions.length > 1 ? `
            <div class="polyphone-bar">
              <div class="polyphone-bar-header">
                <span class="polyphone-label">Other Readings (${versions.length})</span>
              </div>
              <div class="polyphone-dots">
                ${versions.map((v, idx) => `
                  <button class="polyphone-dot-btn ${idx === activeIdx ? 'active' : ''}" data-idx="${idx}" title="${v.pinyin}: ${v.meaning}">
                    <span class="poly-dot-circle"></span>
                    <span class="poly-dot-py">${v.pinyin}</span>
                    <span class="poly-dot-lvl">HSK ${v.level}</span>
                  </button>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      `;
    };

    const attachCardEventListeners = (cardNode, w, versions, activeIdx) => {
      // Long-press copy
      const largeHz = cardNode.querySelector('.card-large-hanzi');
      if (largeHz) {
        this.setupLongPressCopy(largeHz, () => w.hanzi, 'character');
      }
      const pyText = cardNode.querySelector('.card-pinyin-text');
      if (pyText) {
        this.setupLongPressCopy(pyText, () => w.pinyin, 'pinyin');
      }

      // Close modal
      const closeBtn = cardNode.querySelector('.btn-modal-close');
      if (closeBtn) {
        closeBtn.onclick = () => modal.classList.remove('visible');
      }

      // Audio buttons
      const spkHanzi = cardNode.querySelector('#btn-detail-speak');
      if (spkHanzi) {
        spkHanzi.onclick = () => ChineseSpeech.speak(w.hanzi);
      }
      const exSpeak = cardNode.querySelector('#btn-example-speak');
      if (exSpeak && w.example) {
        exSpeak.onclick = () => ChineseSpeech.speak(w.example.zh);
      }

      // Remember / Bookmark
      const remBtn = cardNode.querySelector('.btn-modal-remember');
      if (remBtn) {
        remBtn.onclick = () => {
          const nowRem = DeckManager.toggleRemember(w);
          remBtn.innerHTML = nowRem ? Icons.bookmarkFilled(19, '#E07A5F') : Icons.bookmark(19, '#A39E93');
          remBtn.classList.toggle('active', nowRem);
          this.filterAndRenderList();
        };
      }

      // Polyphone reading switcher (direct tap, no swiping)
      cardNode.querySelectorAll('.polyphone-dot-btn').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const targetIdx = parseInt(btn.dataset.idx, 10);
          if (targetIdx !== activeIdx && versions[targetIdx]) {
            cardNode.innerHTML = buildCardHtml(versions[targetIdx], versions, targetIdx);
            attachCardEventListeners(cardNode, versions[targetIdx], versions, targetIdx);
          }
        };
      });

      // Custom Deck popover
      const addCustomBtn = cardNode.querySelector('#btn-card-add-custom');
      const popover = cardNode.querySelector('#card-deck-popover');
      if (addCustomBtn && popover) {
        addCustomBtn.onclick = (e) => {
          e.stopPropagation();
          const isVisible = popover.classList.contains('visible');
          if (isVisible) {
            popover.classList.remove('visible');
          } else {
            this.renderCardCustomDeckPopover(w, popover);
            popover.classList.add('visible');
          }
        };
      }
    };

    const renderCardElement = (wordObj) => {
      const vers = DeckManager.getWordVersions(wordObj, wordsList);
      let actIdx = vers.findIndex(v => (v.pinyin || '').toLowerCase() === (wordObj.pinyin || '').toLowerCase());
      if (actIdx < 0) actIdx = 0;

      const card = document.createElement('div');
      card.className = 'modal-card';
      card.innerHTML = buildCardHtml(vers[actIdx], vers, actIdx);
      attachCardEventListeners(card, vers[actIdx], vers, actIdx);
      return card;
    };

    let isTransitioning = false;
    let activeCard = null;

    const updateNavButtons = () => {
      if (btnPrev) {
        btnPrev.disabled = currentWordIdx <= 0;
        btnPrev.title = currentWordIdx > 0 ? `Previous word (${currentWordIdx} / ${wordsList.length})` : '';
      }
      if (btnNext) {
        btnNext.disabled = currentWordIdx >= wordsList.length - 1;
        btnNext.title = currentWordIdx < wordsList.length - 1 ? `Next word (${currentWordIdx + 2} / ${wordsList.length})` : '';
      }
    };

    const CARD_GAP = 16;

    // Forward navigation: Slide active card out to the left, slide next card in from the right
    const completeSwipeNext = () => {
      if (isTransitioning || currentWordIdx >= wordsList.length - 1) {
        resetCardPosition(activeCard);
        return;
      }
      isTransitioning = true;
      currentWordIdx++;
      updateNavButtons();

      if (currentWordIdx >= this.renderedCount - 5) {
        this.appendNextChunk(60);
      }

      let companion = stage.querySelector('.modal-companion-card');
      const isFromDrag = !!companion && companion.dataset.swipeDir === 'next';

      if (!isFromDrag) {
        if (companion) companion.remove();
        companion = renderCardElement(wordsList[currentWordIdx]);
        companion.classList.add('modal-companion-card');
        companion.dataset.swipeDir = 'next';
        companion.style.transform = `translate3d(calc(100% + ${CARD_GAP}px), 0, 0)`;
        stage.appendChild(companion);
        void companion.offsetWidth;
      }

      activeCard.style.transition = 'transform 0.28s cubic-bezier(0.25, 1, 0.5, 1)';
      activeCard.style.transform = `translate3d(calc(-100% - ${CARD_GAP}px), 0, 0)`;

      companion.style.transition = 'transform 0.28s cubic-bezier(0.25, 1, 0.5, 1)';
      companion.style.transform = 'translate3d(0, 0, 0)';

      setTimeout(() => {
        if (activeCard && activeCard.parentNode) {
          activeCard.remove();
        }
        companion.classList.remove('modal-companion-card');
        delete companion.dataset.swipeDir;
        companion.style.transform = '';
        companion.style.transition = '';
        activeCard = companion;
        isTransitioning = false;
      }, 290);
    };

    // Backward navigation: Slide active card out to the right, slide prev card in from the left
    const completeSwipePrev = () => {
      if (isTransitioning || currentWordIdx <= 0) {
        resetCardPosition(activeCard);
        return;
      }
      isTransitioning = true;
      currentWordIdx--;
      updateNavButtons();

      let companion = stage.querySelector('.modal-companion-card');
      const isFromDrag = !!companion && companion.dataset.swipeDir === 'prev';

      if (!isFromDrag) {
        if (companion) companion.remove();
        companion = renderCardElement(wordsList[currentWordIdx]);
        companion.classList.add('modal-companion-card');
        companion.dataset.swipeDir = 'prev';
        companion.style.transform = `translate3d(calc(-100% - ${CARD_GAP}px), 0, 0)`;
        stage.appendChild(companion);
        void companion.offsetWidth;
      }

      activeCard.style.transition = 'transform 0.28s cubic-bezier(0.25, 1, 0.5, 1)';
      activeCard.style.transform = `translate3d(calc(100% + ${CARD_GAP}px), 0, 0)`;

      companion.style.transition = 'transform 0.28s cubic-bezier(0.25, 1, 0.5, 1)';
      companion.style.transform = 'translate3d(0, 0, 0)';

      setTimeout(() => {
        if (activeCard && activeCard.parentNode) {
          activeCard.remove();
        }
        companion.classList.remove('modal-companion-card');
        delete companion.dataset.swipeDir;
        companion.style.transform = '';
        companion.style.transition = '';
        activeCard = companion;
        isTransitioning = false;
      }, 290);
    };

    const resetCardPosition = (cardNode) => {
      if (!cardNode) return;
      cardNode.style.transition = 'transform 0.25s cubic-bezier(0.25, 1, 0.5, 1)';
      cardNode.style.transform = 'translate3d(0, 0, 0)';

      const companion = stage.querySelector('.modal-companion-card');
      if (companion) {
        companion.style.transition = 'transform 0.25s cubic-bezier(0.25, 1, 0.5, 1)';
        const dir = companion.dataset.swipeDir;
        if (dir === 'next') {
          companion.style.transform = `translate3d(calc(100% + ${CARD_GAP}px), 0, 0)`;
        } else {
          companion.style.transform = `translate3d(calc(-100% - ${CARD_GAP}px), 0, 0)`;
        }
        setTimeout(() => {
          if (companion && companion.parentNode) companion.remove();
        }, 260);
      }
    };

    // Attach Pointer Gestures on modal for real-time 1:1 side-by-side slide tracking
    let isDragging = false;
      let startX = 0;
      let startY = 0;
      let currentX = 0;
      let currentY = 0;
      let gestureDecided = false;
      let isHorizontalDrag = false;
      let pointerDownTarget = null;

      const onPointerDown = (e) => {
        if (isTransitioning || !activeCard) return;
        if (e.target.closest('button') || e.target.closest('.card-example-card') || e.target.closest('#card-deck-popover') || e.target.closest('.polyphone-dot-btn')) {
          return;
        }

        isDragging = true;
        gestureDecided = false;
        isHorizontalDrag = false;
        pointerDownTarget = e.target;
        startX = e.clientX;
        startY = e.clientY;
        currentX = e.clientX;
        currentY = e.clientY;

        if (activeCard) activeCard.style.transition = 'none';
      };

      const onPointerMove = (e) => {
        if (!isDragging || !activeCard) return;

        currentX = e.clientX;
        currentY = e.clientY;
        const deltaX = currentX - startX;
        const deltaY = currentY - startY;

        if (!gestureDecided) {
          const absX = Math.abs(deltaX);
          const absY = Math.abs(deltaY);
          if (absX < 6 && absY < 6) return;

          gestureDecided = true;
          if (absX > absY * 1.1) {
            isHorizontalDrag = true;
            try {
              modal.setPointerCapture(e.pointerId);
            } catch (err) {}
          } else {
            isHorizontalDrag = false;
            isDragging = false;
            return;
          }
        }

        if (!isHorizontalDrag || !activeCard) return;

        // Apply resistance if swiping at boundaries
        let effectiveDeltaX = deltaX;
        if ((deltaX < 0 && currentWordIdx >= wordsList.length - 1) || (deltaX > 0 && currentWordIdx <= 0)) {
          effectiveDeltaX = deltaX * 0.25;
        }

        // Active card moves exactly with finger
        activeCard.style.transform = `translate3d(${effectiveDeltaX}px, 0, 0)`;

        // Determine intended companion direction
        const neededDir = deltaX < -3 ? 'next' : (deltaX > 3 ? 'prev' : null);

        let companion = stage.querySelector('.modal-companion-card');
        const currentDir = companion ? companion.dataset.swipeDir : null;

        if (neededDir && neededDir !== currentDir) {
          if (companion) {
            companion.remove();
            companion = null;
          }

          if (neededDir === 'next' && currentWordIdx < wordsList.length - 1) {
            companion = renderCardElement(wordsList[currentWordIdx + 1]);
            companion.classList.add('modal-companion-card');
            companion.dataset.swipeDir = 'next';
            stage.appendChild(companion);
          } else if (neededDir === 'prev' && currentWordIdx > 0) {
            companion = renderCardElement(wordsList[currentWordIdx - 1]);
            companion.classList.add('modal-companion-card');
            companion.dataset.swipeDir = 'prev';
            stage.appendChild(companion);
          }
        }

        if (companion) {
          companion.style.transition = 'none';
          if (companion.dataset.swipeDir === 'next') {
            companion.style.transform = `translate3d(calc(100% + ${effectiveDeltaX}px + ${CARD_GAP}px), 0, 0)`;
          } else if (companion.dataset.swipeDir === 'prev') {
            companion.style.transform = `translate3d(calc(-100% + ${effectiveDeltaX}px - ${CARD_GAP}px), 0, 0)`;
          }
        }
      };

      const onPointerUp = (e) => {
        if (!isDragging) return;
        isDragging = false;

        try {
          if (modal.hasPointerCapture && modal.hasPointerCapture(e.pointerId)) {
            modal.releasePointerCapture(e.pointerId);
          }
        } catch (err) {}

        if (window.App && (window.App.ignoreNextClick || window.App.longPressActive)) {
          resetCardPosition(activeCard);
          return;
        }

        const endX = (e && typeof e.clientX === 'number') ? e.clientX : currentX;
        const endY = (e && typeof e.clientY === 'number') ? e.clientY : currentY;
        const deltaX = endX - startX;
        const deltaY = endY - startY;

        if (isHorizontalDrag) {
          const threshold = 48; // Snappy, natural swipe threshold
          if (deltaX < -threshold && currentWordIdx < wordsList.length - 1) {
            completeSwipeNext();
          } else if (deltaX > threshold && currentWordIdx > 0) {
            completeSwipePrev();
          } else {
            resetCardPosition(activeCard);
          }
        } else {
          // Tap handling: close only on intentional taps outside (above, below, or far outside)
          if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) {
            const stageRect = stage.getBoundingClientRect();
            const inVerticalSpan = (endY >= stageRect.top - 16 && endY <= stageRect.bottom + 16);
            const inImmediateLeftMargin = (endX < stageRect.left && endX >= stageRect.left - 80);
            const inImmediateRightMargin = (endX > stageRect.right && endX <= stageRect.right + 80);

            // Block tap-to-exit on the margin space immediately to the left and right of the card (e.g. above/below arrow buttons)
            if (inVerticalSpan && (inImmediateLeftMargin || inImmediateRightMargin)) {
              return;
            }

            // Do not exit if tapping inside the card stage
            if (pointerDownTarget && (stage === pointerDownTarget || stage.contains(pointerDownTarget))) {
              return;
            }

            // Exit if tapping the backdrop outside (above, below, or far outside)
            if (pointerDownTarget === modal) {
              modal.classList.remove('visible');
            }
          }
        }
      };

      modal.onpointerdown = onPointerDown;
      modal.onpointermove = onPointerMove;
      modal.onpointerup = onPointerUp;
      modal.onpointercancel = onPointerUp;

    // Initialize initial card in stage
    stage.innerHTML = '';
    activeCard = renderCardElement(wordsList[currentWordIdx]);
    stage.appendChild(activeCard);
    updateNavButtons();

    // Wire up outside Chevron Head buttons
    if (btnPrev) {
      btnPrev.onclick = (e) => {
        e.stopPropagation();
        completeSwipePrev();
      };
    }

    if (btnNext) {
      btnNext.onclick = (e) => {
        e.stopPropagation();
        completeSwipeNext();
      };
    }

    // Keyboard navigation (ArrowLeft / ArrowRight / Escape)
    document.onkeydown = (e) => {
      if (!modal.classList.contains('visible')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        completeSwipeNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        completeSwipePrev();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        modal.classList.remove('visible');
      }
    };

    modal.classList.add('visible');
  },

  renderCardCustomDeckPopover(word, popover) {
    const customDecks = DeckManager.getCustomDecks();
    let itemsHtml = `<div class="custom-deck-popover-title">Add to Deck</div>`;

    if (customDecks.length === 0) {
      itemsHtml += `<div style="font-size: 12px; color: var(--text-muted); padding: 6px 8px;">No custom decks yet.</div>`;
    } else {
      itemsHtml += customDecks.map(cd => {
        const inDeck = (cd.words || []).some(w => w.hanzi === word.hanzi);
        return `
          <button class="popover-deck-item ${inDeck ? 'in-deck' : ''}" data-deck-id="${cd.id}">
            <span>${cd.name}</span>
            ${inDeck ? Icons.check(14, '#52A1B1') : ''}
          </button>
        `;
      }).join('');
    }

    itemsHtml += `
      <button class="popover-create-btn" id="btn-popover-create-deck">
        ${Icons.plus(14, '#52A1B1')}
        <span>Create New Deck</span>
      </button>
    `;

    popover.innerHTML = itemsHtml;

    popover.querySelectorAll('.popover-deck-item').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const deckId = btn.dataset.deckId;
        const cd = DeckManager.getCustomDeck(deckId);
        const inDeck = (cd.words || []).some(w => w.hanzi === word.hanzi);
        if (inDeck) {
          DeckManager.removeWordFromCustomDeck(deckId, word.hanzi);
        } else {
          DeckManager.addWordToCustomDeck(deckId, word);
        }
        this.renderCardCustomDeckPopover(word, popover);
      };
    });

    popover.querySelector('#btn-popover-create-deck').onclick = (e) => {
      e.stopPropagation();
      const name = prompt('Enter a name for your new custom deck:');
      if (name && name.trim()) {
        const newDeck = DeckManager.createCustomDeck(name.trim());
        DeckManager.addWordToCustomDeck(newDeck.id, word);
        this.renderCardCustomDeckPopover(word, popover);
        this.renderDeckSelector();
      }
    };
  },

  onStudyButtonPressed() {
    const saved = FlashcardEngine.getSavedSession();
    if (saved && saved.state && saved.state.poolWords && saved.state.poolWords.length > 0) {
      this.openResumeOrNewModal(saved);
    } else {
      this.openStudySetupModal();
    }
  },

  openResumeOrNewModal(saved) {
    const modal = document.getElementById('study-resume-modal');
    if (!modal) {
      this.openStudySetupModal();
      return;
    }

    const titleEl = modal.querySelector('#resume-deck-title');
    const progEl = modal.querySelector('#resume-deck-progress');
    let displayDeckLabel = saved.config.deckLabel || 'Previous Deck';
    if (saved.config.deckId && saved.config.deckId.endsWith('_cum')) {
      const baseDef = DeckManager.getDeckDef(DeckManager.getBaseDeckId(saved.config.deckId));
      if (baseDef) {
        displayDeckLabel = `${baseDef.label} (including previous levels)`;
        saved.config.deckLabel = displayDeckLabel;
      }
    }
    if (titleEl) titleEl.textContent = displayDeckLabel;
    if (progEl) {
      const batchNum = (saved.state.currentBatchIndex || 0) + 1;
      const cardNum = Math.min((saved.state.currentIndex || 0) + 1, (saved.state.currentSubdeck || []).length);
      const totalInSubdeck = (saved.state.currentSubdeck || []).length;
      progEl.textContent = `Batch #${batchNum} · Card ${cardNum} of ${totalInSubdeck}`;
    }

    modal.classList.add('visible');

    modal.querySelector('#btn-resume-modal-close').onclick = () => {
      modal.classList.remove('visible');
    };

    modal.onclick = (e) => {
      if (e.target === modal) modal.classList.remove('visible');
    };

    modal.querySelector('#btn-resume-session').onclick = async () => {
      modal.classList.remove('visible');
      const baseId = DeckManager.getBaseDeckId(saved.config.deckId);
      this.selectedDeckId = baseId;
      if (saved.config.deckId && saved.config.deckId.endsWith('_cum')) {
        this.includePreviousLevels = true;
      }
      this.renderDeckSelector();

      this.switchTab('flashcard');
      const container = document.getElementById('flashcard-arena');
      if (container) {
        container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Resuming study session...</p></div>`;
      }

      this.currentDeckWords = await DeckManager.getDeckWords(saved.config.deckId);

      FlashcardEngine.init(saved.config, {
        onCardChange: (data) => this.renderFlashcardScreen(data),
        onRoundComplete: (data) => this.renderRoundReviewScreen(data),
        onBatchMastered: (data) => this.renderBatchMasteredScreen(data),
        onSessionComplete: () => this.renderSessionCompleteScreen()
      });
      await FlashcardEngine.resumeSavedSession();
    };

    modal.querySelector('#btn-start-fresh-session').onclick = () => {
      modal.classList.remove('visible');
      FlashcardEngine.clearSavedSession();
      this.openStudySetupModal();
    };
  },

  openStudyExitConfirmModal() {
    const modal = document.getElementById('study-exit-modal');
    if (!modal) {
      this.selectedDeckId = 'all_words';
      const mainSelect = document.getElementById('deck-select');
      if (mainSelect) mainSelect.value = 'all_words';
      this.switchTab('list');
      return;
    }

    modal.classList.add('visible');

    modal.querySelector('#btn-confirm-exit-study').onclick = () => {
      modal.classList.remove('visible');
      FlashcardEngine.saveSessionToStorage();
      this.selectedDeckId = 'all_words';
      const mainSelect = document.getElementById('deck-select');
      if (mainSelect) mainSelect.value = 'all_words';
      this.switchTab('list');
    };

    modal.querySelector('#btn-cancel-exit-study').onclick = () => {
      modal.classList.remove('visible');
    };

    modal.onclick = (e) => {
      if (e.target === modal) modal.classList.remove('visible');
    };
  },

  // --- Flashcard Study Setup Modal ---
  openStudySetupModal(preferredDeckId = null) {
    const modal = document.getElementById('study-setup-modal');
    if (!modal) return;

    const initialBaseDeckId = DeckManager.getBaseDeckId(preferredDeckId || this.selectedDeckId);
    let modalIncludePrevious = this.includePreviousLevels;

    const deckSelect = modal.querySelector('#setup-deck-select');
    const toggleWrap = modal.querySelector('#setup-cumulative-toggle-wrap');
    const toggleInput = modal.querySelector('#setup-cumulative-toggle');

    const updateModalDeckDisplay = () => {
      const currentVal = DeckManager.getBaseDeckId(deckSelect.value || initialBaseDeckId);
      const isEligible = DeckManager.isCumulativeEligible(currentVal);
      if (isEligible) {
        if (toggleWrap) toggleWrap.style.display = 'flex';
        if (toggleInput) toggleInput.checked = Boolean(modalIncludePrevious);
      } else {
        if (toggleWrap) toggleWrap.style.display = 'none';
      }
      deckSelect.innerHTML = this.renderDeckOptionsHTML(currentVal);
      deckSelect.value = currentVal;
    };

    updateModalDeckDisplay();

    // Pre-populate range inputs based on current deck count
    const rangeStart = modal.querySelector('#range-start');
    const rangeEnd = modal.querySelector('#range-end');
    const rangeHint = modal.querySelector('#range-preview-hint');

    const updateDeckRangeDefaults = async () => {
      const chosenDeck = DeckManager.getBaseDeckId(deckSelect.value);
      const effectiveId = DeckManager.getEffectiveDeckId(chosenDeck, modalIncludePrevious);
      const words = await DeckManager.getDeckWords(effectiveId);
      rangeEnd.placeholder = `${words.length} (End of deck)`;
      updateRangePreview();
    };

    const updateRangePreview = () => {
      const subdeckSize = parseInt(modal.querySelector('.btn-pill-size.active')?.dataset.size || '25');
      const startVal = parseInt(rangeStart.value) || 1;
      const endVal = rangeEnd.value ? parseInt(rangeEnd.value) : (rangeEnd.placeholder || 'End of Deck');
      
      const firstBatchEnd = startVal + subdeckSize - 1;
      rangeHint.innerHTML = `Study pool: Card <strong>#${startVal}</strong> to <strong>#${endVal}</strong>.<br>First subdeck: cards <strong>#${startVal}</strong> – <strong>#${firstBatchEnd}</strong>.`;
    };

    deckSelect.onchange = () => {
      updateModalDeckDisplay();
      updateDeckRangeDefaults();
    };

    if (toggleInput) {
      toggleInput.onchange = () => {
        modalIncludePrevious = toggleInput.checked;
        updateModalDeckDisplay();
        updateDeckRangeDefaults();
      };
    }

    rangeStart.oninput = updateRangePreview;
    rangeEnd.oninput = updateRangePreview;
    updateDeckRangeDefaults();

    modal.querySelectorAll('.btn-pill-size').forEach(btn => {
      btn.onclick = () => {
        modal.querySelectorAll('.btn-pill-size').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const customInput = modal.querySelector('#custom-size-input');
        if (btn.dataset.size === 'custom') {
          customInput.style.display = 'block';
          customInput.focus();
        } else {
          customInput.style.display = 'none';
        }
        updateRangePreview();
      };
    });

    updateRangePreview();
    modal.classList.add('visible');
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === 'study');
    });

    const closeBtn = modal.querySelector('#btn-modal-setup-close');
    if (closeBtn) {
      closeBtn.onclick = () => {
        modal.classList.remove('visible');
        const restoreTab = this.activeTab === 'flashcard' ? 'list' : this.activeTab;
        document.querySelectorAll('.tab-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.tab === restoreTab);
        });
      };
    }

    modal.querySelector('#btn-launch-study').onclick = async () => {
      const chosenBaseId = DeckManager.getBaseDeckId(deckSelect.value);
      const isEligible = DeckManager.isCumulativeEligible(chosenBaseId);
      const includePrev = isEligible ? Boolean(toggleInput && toggleInput.checked) : false;

      if (isEligible) {
        this.includePreviousLevels = includePrev;
        try {
          localStorage.setItem('hsk_include_prev_levels', this.includePreviousLevels ? 'true' : 'false');
        } catch {}
      }

      const effectiveDeckId = DeckManager.getEffectiveDeckId(chosenBaseId, includePrev);
      this.selectedDeckId = chosenBaseId;
      this.renderDeckSelector();

      const sizeBtn = modal.querySelector('.btn-pill-size.active');
      let size = 25;
      if (sizeBtn.dataset.size === 'custom') {
        size = parseInt(modal.querySelector('#custom-size-input').value) || 25;
      } else {
        size = parseInt(sizeBtn.dataset.size) || 25;
      }

      const pullOrder = modal.querySelector('input[name="pull-order"]:checked').value;
      const subdeckOrder = modal.querySelector('input[name="subdeck-order"]:checked').value;
      const cardFace = modal.querySelector('input[name="card-face"]:checked').value;

      const rStart = parseInt(rangeStart.value) || 1;
      const rEnd = rangeEnd.value ? parseInt(rangeEnd.value) : null;

      modal.classList.remove('visible');
      await this.startFlashcardSession({
        deckId: effectiveDeckId,
        subdeckSize: size,
        pullOrder,
        subdeckOrder,
        cardFace,
        rangeStart: rStart,
        rangeEnd: rEnd
      });
    };
  },

  async startFlashcardSession(settings) {
    const baseId = DeckManager.getBaseDeckId(settings.deckId);
    this.selectedDeckId = baseId;
    const mainSelect = document.getElementById('deck-select');
    if (mainSelect) mainSelect.value = baseId;

    this.switchTab('flashcard');
    const container = document.getElementById('flashcard-arena');
    container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Preparing subdeck...</p></div>`;

    const deckWords = await DeckManager.getDeckWords(settings.deckId);
    this.currentDeckWords = deckWords;
    if (!deckWords || deckWords.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p class="empty-title">This deck is empty</p>
          <p class="empty-subtitle">Add words or select a different deck to study.</p>
          <button class="btn-primary" onclick="App.openStudySetupModal()">Change Setup</button>
        </div>
      `;
      return;
    }

    const deckDef = DeckManager.getDeckDef(settings.deckId);
    let label = deckDef ? deckDef.label : 'Deck';
    if (settings.deckId && settings.deckId.endsWith('_cum')) {
      const baseDef = DeckManager.getDeckDef(DeckManager.getBaseDeckId(settings.deckId));
      if (baseDef) {
        label = `${baseDef.label} (including previous levels)`;
      }
    }
    FlashcardEngine.init({
      ...settings,
      deckLabel: label
    }, {
      onCardChange: (data) => this.renderFlashcardScreen(data),
      onRoundComplete: (data) => this.renderRoundReviewScreen(data),
      onBatchMastered: (data) => this.renderBatchMasteredScreen(data),
      onSessionComplete: () => this.renderSessionCompleteScreen()
    });

    FlashcardEngine.startSession(deckWords);
  },

  // Render active card in Flashcard Mode
  renderFlashcardScreen(data) {
    const container = document.getElementById('flashcard-arena');
    if (!container) return;

    const { card, index, total, isRevealed, isReviewRound, cardFace, batchNumber, incorrectCount, canGoPrev, canGoNext, previousAnswer, isSessionInitialCard } = data;
    if (!card) return;

    const isRem = DeckManager.isRemembered(card.hanzi);

    // Get all versions of this polyphone word across curriculum
    const versions = DeckManager.getWordVersions(card, this.currentDeckWords || FlashcardEngine.state.poolWords);
    let activeVersionIdx = versions.findIndex(v => (v.pinyin || '').toLowerCase() === (card.pinyin || '').toLowerCase());
    if (activeVersionIdx < 0) activeVersionIdx = 0;
    let activeCard = versions[activeVersionIdx] || card;
    if (!activeCard.pos && DeckManager.globalSearchPool) {
      const cleanPy = DeckManager.cleanPinyin(activeCard.pinyin || '');
      const match = DeckManager.globalSearchPool.find(m => m.hanzi === activeCard.hanzi && (cleanPy ? DeckManager.cleanPinyin(m.pinyin || '') === cleanPy : true)) ||
                    DeckManager.globalSearchPool.find(m => m.hanzi === activeCard.hanzi);
      if (match && match.pos) activeCard.pos = match.pos;
    }
    const nextCard = FlashcardEngine.getNextCard();

    container.innerHTML = `
      <div class="study-header">
        <button class="btn-icon" id="btn-study-exit" title="Exit to Words List">${Icons.chevronLeft(20)}</button>
        <div class="study-progress-info">
          <span class="study-deck-title">${FlashcardEngine.config.deckLabel}</span>
          <span class="study-batch-tag">${isReviewRound ? 'Retry Round' : `Batch #${batchNumber}`} · ${index} / ${total}</span>
        </div>
        <div class="study-header-actions" style="position: relative; display: flex; align-items: center; gap: 4px;">
          <button class="btn-icon btn-card-add-custom" id="btn-fc-add-custom" title="Add to Custom Deck">
            ${Icons.plus(19)}
          </button>
          <button class="btn-icon btn-study-remember ${isRem ? 'active' : ''}" title="Bookmark">
            ${isRem ? Icons.bookmarkFilled(20, '#E07A5F') : Icons.bookmark(20, '#A39E93')}
          </button>
          <div class="custom-deck-popover" id="fc-deck-popover"></div>
        </div>
      </div>

      <div class="study-progress-bar">
        <div class="study-progress-fill" style="width: ${((index - 1) / total) * 100}%"></div>
      </div>

      <div class="card-stage">
        <!-- Top Navigation Bar for Card Skipping/Review -->
        <div class="card-nav-bar">
          <button class="btn-card-nav-arrow" id="btn-card-nav-prev" ${canGoPrev ? '' : 'disabled'} title="Previous card">
            ${Icons.chevronLeft(18)}
            <span>Prev</span>
          </button>
          <div class="card-nav-pill">
            <span class="card-nav-curr">${index}</span>
            <span class="card-nav-slash">/</span>
            <span class="card-nav-total">${total}</span>
            ${previousAnswer === true ? `
              <span class="card-status-chip chip-correct" title="Latest swipe: Correct">${Icons.check(11, '#52A1B1')} Correct</span>
            ` : previousAnswer === false ? `
              <span class="card-status-chip chip-review" title="Latest swipe: Review">${Icons.cross(11, '#D9534F')} Review</span>
            ` : ''}
          </div>
          <button class="btn-card-nav-arrow" id="btn-card-nav-next" ${canGoNext ? '' : 'disabled'} title="${canGoNext ? 'Next card' : 'Encounter this card first'}">
            <span>Next</span>
            ${Icons.chevronRight(18)}
          </button>
        </div>

        <div class="card-stage-stack">
          ${nextCard ? `
            <div class="flashcard flashcard-underneath" id="underneath-study-card">
              <div class="card-inner">
                <div class="card-face card-front">
                  <span class="card-index-tag">#${nextCard.deckIndex || nextCard.id}</span>
                  <div class="lone-word-wrap">
                    ${cardFace === 'chinese' ? `
                      <div class="lone-hanzi">${nextCard.hanzi}</div>
                    ` : `
                      <div class="lone-english">${nextCard.meaning || 'Meaning'}</div>
                    `}
                  </div>
                </div>
              </div>
            </div>
          ` : ''}

          <div class="flashcard ${isRevealed ? 'revealed' : ''}" id="active-study-card">
            <!-- Swipe badges -->
            <div class="swipe-badge swipe-badge-right">
              ${Icons.check(22, '#52A1B1')}
              <span>CORRECT</span>
            </div>
          <div class="swipe-badge swipe-badge-left">
            ${Icons.cross(22, '#D9534F')}
            <span>REVIEW</span>
          </div>

          <div class="card-inner">
            <!-- Front Face (Lone Word) -->
            <div class="card-face card-front">
              <span class="card-index-tag">#${activeCard.deckIndex || activeCard.id}</span>
              <div class="lone-word-wrap">
                ${cardFace === 'chinese' ? `
                  <div class="lone-hanzi">${activeCard.hanzi}</div>
                ` : `
                  <div class="lone-english">${activeCard.meaning || 'Meaning'}</div>
                `}
              </div>
              ${versions.length > 1 ? `
                <div class="front-poly-indicator">
                  <span class="poly-badge">多音字 · ${versions.length} readings</span>
                </div>
              ` : ''}
              ${isSessionInitialCard ? `
                <div class="first-card-hints">
                  <div class="hint-tap-row">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
                    </svg>
                    <span>Double tap to flip</span>
                  </div>
                  <div class="hint-swipe-row">
                    <span class="hint-swipe-side hint-swipe-left">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                      Swipe if incorrect
                    </span>
                    <span class="hint-separator">·</span>
                    <span class="hint-swipe-side hint-swipe-right">
                      Swipe if correct
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                    </span>
                  </div>
                </div>
              ` : ''}
            </div>

            <!-- Revealed Content -->
            <div class="card-face card-revealed-details">
              <div class="revealed-header">
                <span class="card-index-tag">#${activeCard.deckIndex || activeCard.id}</span>
                <div class="revealed-word-group">
                  <div class="revealed-hanzi">${activeCard.hanzi}</div>
                  <div class="revealed-pinyin-row">
                    <span class="revealed-pinyin-text">${activeCard.pinyin}</span>
                    <button class="btn-speaker-round" id="btn-card-audio" title="Listen" aria-label="Listen">
                      ${Icons.speaker(17, '#52A1B1')}
                    </button>
                  </div>
                </div>
              </div>

              <div class="revealed-meaning-box">
                <label>MEANING${activeCard.pos ? ` • <span class="card-pos-tag">${activeCard.pos.toUpperCase()}</span>` : ''}</label>
                <p>${activeCard.meaning}</p>
              </div>

              <div class="revealed-example-box" style="${activeCard.example ? '' : 'display: none;'}">
                <div class="example-top">
                  <label>EXAMPLE</label>
                  <button class="btn-icon-tiny" id="btn-card-ex-audio">${Icons.speaker(14, '#52A1B1')}</button>
                </div>
                <div class="example-sentences-wrap">
                  <p class="ex-zh">${activeCard.example ? activeCard.example.zh : ''}</p>
                  <p class="ex-py">${activeCard.example ? activeCard.example.py : ''}</p>
                  <p class="ex-en">${activeCard.example ? activeCard.example.en : ''}</p>
                </div>
              </div>

              ${versions.length > 1 ? `
                <div class="flashcard-poly-dots-row">
                  <span class="flashcard-poly-hint">Readings:</span>
                  ${versions.map((v, idx) => `
                    <button class="fc-poly-dot-btn ${idx === activeVersionIdx ? 'active' : ''}" data-idx="${idx}" title="${v.pinyin}: ${v.meaning}">
                      <span class="fc-dot-circle"></span>
                      <span class="fc-dot-label">${v.pinyin}</span>
                    </button>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          </div>
        </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="study-actions">
        <button class="btn-action btn-action-wrong" id="btn-action-wrong" title="Mark for review (Swipe Left)">
          ${Icons.cross(24, '#E07A5F')}
        </button>
        
        <button class="btn-action btn-action-reveal ${isRevealed ? 'is-revealed' : ''}" id="btn-action-reveal" title="${isRevealed ? 'Hide details (Flip back)' : 'Reveal details (Flip)'}">
          ${isRevealed ? Icons.eyeOff(22, '#4A6B82') : Icons.eye(22, '#4A6B82')}
          <span>${isRevealed ? 'Hide' : 'Reveal'}</span>
        </button>

        <button class="btn-action btn-action-correct" id="btn-action-correct" title="Mark correct (Swipe Right)">
          ${Icons.check(24, '#52A1B1')}
        </button>
      </div>
    `;

    // Attach gestures
    const cardEl = container.querySelector('#active-study-card');
    FlashcardEngine.attachSwipe(cardEl, () => {
      FlashcardEngine.markIncorrect();
    }, () => {
      FlashcardEngine.markCorrect();
    });

    // Long-press auto-copy ONLY on revealed card character(s) and pinyin (front face lone word is not copyable)
    const revHz = cardEl.querySelector('.revealed-hanzi');
    if (revHz) {
      this.setupLongPressCopy(revHz, () => activeCard.hanzi, 'character');
    }

    const revPy = cardEl.querySelector('.revealed-pinyin-text');
    if (revPy) {
      this.setupLongPressCopy(revPy, () => activeCard.pinyin, 'pinyin');
    }

    // Navigation buttons (Prev / Next)
    const btnPrev = container.querySelector('#btn-card-nav-prev');
    if (btnPrev) {
      btnPrev.onclick = () => {
        FlashcardEngine.goToPrevCard();
      };
    }

    const btnNext = container.querySelector('#btn-card-nav-next');
    if (btnNext) {
      btnNext.onclick = () => {
        FlashcardEngine.goToNextCard();
      };
    }

    // Button clicks
    container.querySelector('#btn-study-exit').onclick = () => {
      this.openStudyExitConfirmModal();
    };

    // Custom Deck popover in flashcard mode
    const fcAddCustomBtn = container.querySelector('#btn-fc-add-custom');
    const fcPopover = container.querySelector('#fc-deck-popover');
    if (fcAddCustomBtn && fcPopover) {
      fcAddCustomBtn.onclick = (e) => {
        e.stopPropagation();
        const isVisible = fcPopover.classList.contains('visible');
        if (isVisible) {
          fcPopover.classList.remove('visible');
        } else {
          this.renderCardCustomDeckPopover(activeCard, fcPopover);
          fcPopover.classList.add('visible');
        }
      };
      const closePopoverHandler = (e) => {
        if (!fcPopover.contains(e.target) && e.target !== fcAddCustomBtn && !fcAddCustomBtn.contains(e.target)) {
          fcPopover.classList.remove('visible');
          document.removeEventListener('click', closePopoverHandler);
        }
      };
      document.addEventListener('click', closePopoverHandler);
    }

    container.querySelector('.btn-study-remember').onclick = () => {
      const nowRem = DeckManager.toggleRemember(activeCard);
      const btn = container.querySelector('.btn-study-remember');
      btn.innerHTML = nowRem ? Icons.bookmarkFilled(20, '#E07A5F') : Icons.bookmark(20, '#A39E93');
      btn.classList.toggle('active', nowRem);
    };

    container.querySelector('#btn-action-reveal').onclick = () => {
      FlashcardEngine.toggleCardReveal();
    };

    container.querySelector('#btn-action-wrong').onclick = () => {
      FlashcardEngine.triggerSwipeAnswer(-1);
    };

    container.querySelector('#btn-action-correct').onclick = () => {
      FlashcardEngine.triggerSwipeAnswer(1);
    };

    const cardAudio = container.querySelector('#btn-card-audio');
    if (cardAudio) {
      cardAudio.onclick = (e) => {
        e.stopPropagation();
        ChineseSpeech.speak(activeCard.hanzi);
      };
    }

    const exAudio = container.querySelector('#btn-card-ex-audio');
    if (exAudio) {
      exAudio.onclick = (e) => {
        e.stopPropagation();
        if (activeCard.example && activeCard.example.zh) {
          ChineseSpeech.speak(activeCard.example.zh);
        }
      };
    }

    // Polyphone reading switcher dots
    cardEl.querySelectorAll('.fc-poly-dot-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        const targetIdx = parseInt(btn.dataset.idx, 10);
        if (targetIdx === activeVersionIdx || !versions[targetIdx]) return;

        activeVersionIdx = targetIdx;
        activeCard = versions[activeVersionIdx];
        if (!activeCard.pos && DeckManager.globalSearchPool) {
          const cleanPy = DeckManager.cleanPinyin(activeCard.pinyin || '');
          const match = DeckManager.globalSearchPool.find(m => m.hanzi === activeCard.hanzi && (cleanPy ? DeckManager.cleanPinyin(m.pinyin || '') === cleanPy : true)) ||
                        DeckManager.globalSearchPool.find(m => m.hanzi === activeCard.hanzi);
          if (match && match.pos) activeCard.pos = match.pos;
        }

        // Update active class on buttons
        cardEl.querySelectorAll('.fc-poly-dot-btn').forEach((b, i) => {
          b.classList.toggle('active', i === activeVersionIdx);
        });

        // Update Pinyin
        const pyText = cardEl.querySelector('.revealed-pinyin-text');
        if (pyText) pyText.textContent = activeCard.pinyin;

        // Update Meaning
        const meaningBox = cardEl.querySelector('.revealed-meaning-box');
        if (meaningBox) {
          const meaningLabel = meaningBox.querySelector('label');
          if (meaningLabel) {
            meaningLabel.innerHTML = `MEANING${activeCard.pos ? ` • <span class="card-pos-tag">${activeCard.pos.toUpperCase()}</span>` : ''}`;
          }
          const meaningP = meaningBox.querySelector('p');
          if (meaningP) meaningP.textContent = activeCard.meaning || '';
        }

        // Update Example
        const exBox = cardEl.querySelector('.revealed-example-box');
        if (exBox) {
          if (activeCard.example) {
            exBox.style.display = '';
            const zhEl = exBox.querySelector('.ex-zh');
            const pyEl = exBox.querySelector('.ex-py');
            const enEl = exBox.querySelector('.ex-en');
            if (zhEl) zhEl.textContent = activeCard.example.zh;
            if (pyEl) pyEl.textContent = activeCard.example.py;
            if (enEl) enEl.textContent = activeCard.example.en;
          } else {
            exBox.style.display = 'none';
          }
        }

        // Update front English if applicable
        const loneEng = cardEl.querySelector('.lone-english');
        if (loneEng) loneEng.textContent = activeCard.meaning || 'Meaning';

        // Update card index tag
        cardEl.querySelectorAll('.card-index-tag').forEach(tag => {
          tag.textContent = `#${activeCard.deckIndex || activeCard.id || card.deckIndex || card.id}`;
        });
      };
    });
  },

  // Screen shown when batch finished with incorrect cards: Round-based Retry
  renderRoundReviewScreen(data) {
    const container = document.getElementById('flashcard-arena');
    if (!container) return;

    container.innerHTML = `
      <div class="result-card">
        <div class="result-icon-wrap review-icon">
          ${Icons.refresh(36, '#D97736')}
        </div>
        <h2 class="result-title">Complete</h2>
        <p class="result-stats">
          ${data.incorrectCount === 0 
            ? `<strong>${data.correctCount}</strong> words studied` 
            : `<strong>${data.correctCount}</strong> words correct, <strong>${data.incorrectCount}</strong> words incorrect`}
        </p>
        <p class="result-message">
          ${data.incorrectCount === 0 
            ? `Batch #${data.batchIndex + 1} completed!` 
            : `You have <strong>${data.incorrectCount}</strong> incorrect ${data.incorrectCount === 1 ? 'word' : 'words'}.`}
        </p>

        <button class="btn-primary" id="btn-redo-incorrect">
          ${Icons.refresh(18)}
          <span>Redo Incorrect Words (${data.incorrectCount})</span>
        </button>

        ${!data.isLastBatch ? `
          <button class="btn-primary" id="btn-skip-to-next" style="background: var(--slate);">
            ${Icons.cards(18)}
            <span>Continue to Next Batch</span>
          </button>
        ` : `
          <button class="btn-primary" id="btn-finish-session" style="background: var(--slate);">
            ${Icons.check(18)}
            <span>Finish Session</span>
          </button>
        `}

        <button class="btn-secondary" id="btn-exit-to-list">
          Back to Words List
        </button>
      </div>
    `;

    container.querySelector('#btn-redo-incorrect').onclick = () => {
      FlashcardEngine.startRedoIncorrect();
    };

    const nextBtn = container.querySelector('#btn-skip-to-next');
    if (nextBtn) {
      nextBtn.onclick = () => {
        FlashcardEngine.proceedToNextBatch();
      };
    }

    const finishBtn = container.querySelector('#btn-finish-session');
    if (finishBtn) {
      finishBtn.onclick = () => {
        FlashcardEngine.clearSavedSession();
        this.switchTab('list');
      };
    }

    container.querySelector('#btn-exit-to-list').onclick = () => {
      this.openStudyExitConfirmModal();
    };
  },

  // Screen shown when batch is 100% mastered or redone with 0 errors
  renderBatchMasteredScreen(data) {
    const container = document.getElementById('flashcard-arena');
    if (!container) return;

    container.innerHTML = `
      <div class="result-card">
        <div class="result-icon-wrap success-icon">
          ${Icons.check(38, '#3D6A4D')}
        </div>
        <h2 class="result-title">Complete</h2>
        <p class="result-stats">
          <strong>${data.batchSize}</strong> words studied
        </p>
        <p class="result-message">
          Batch #${data.batchIndex + 1} completed!
        </p>
        
        ${!data.isLastBatch ? `
          <button class="btn-primary" id="btn-next-batch">
            ${Icons.cards(18)}
            <span>Continue to Next Batch</span>
          </button>
        ` : `
          <button class="btn-primary" id="btn-finish-session">
            ${Icons.check(18)}
            <span>Finish Session</span>
          </button>
        `}

        <button class="btn-secondary" id="btn-exit-to-list">
          Back to Words List
        </button>
      </div>
    `;

    if (!data.isLastBatch) {
      container.querySelector('#btn-next-batch').onclick = () => {
        FlashcardEngine.proceedToNextBatch();
      };
    } else {
      container.querySelector('#btn-finish-session').onclick = () => {
        FlashcardEngine.clearSavedSession();
        this.switchTab('list');
      };
    }

    container.querySelector('#btn-exit-to-list').onclick = () => {
      this.openStudyExitConfirmModal();
    };
  },

  // Entire range / deck complete
  renderSessionCompleteScreen() {
    FlashcardEngine.clearSavedSession();
    const container = document.getElementById('flashcard-arena');
    if (!container) return;

    container.innerHTML = `
      <div class="result-card">
        <div class="result-icon-wrap success-icon">
          ${Icons.trophy(44, '#3D6A4D')}
        </div>
        <h2 class="result-title">Complete</h2>
        <p class="result-stats">You have completed all cards in your study range!</p>
        <button class="btn-primary" onclick="App.openStudySetupModal()">
          ${Icons.cards(18)}
          <span>Study Another Range or Deck</span>
        </button>
        <button class="btn-secondary" onclick="App.switchTab('list')">
          Return to Words List
        </button>
      </div>
    `;
  },

  // --- Custom Decks View & Management ---
  renderCustomDecksView() {
    const wrap = document.getElementById('custom-decks-list');
    if (!wrap) return;

    const rememberWords = DeckManager.getRememberWords();
    const customDecks = DeckManager.getCustomDecks();

    let html = `
      <!-- Bookmarked Deck Card -->
      <div class="deck-summary-card" data-deck-id="remember">
        <div class="deck-card-top">
          <div class="deck-icon-badge remember-badge">${Icons.bookmarkFilled(22, '#E07A5F')}</div>
          <div class="deck-details">
            <h3 class="deck-name">Bookmarked</h3>
            <span class="deck-meta">${rememberWords.length} words saved</span>
          </div>
          <div class="deck-card-arrow">${Icons.chevronRight(18, '#8FA8AD')}</div>
        </div>
      </div>

      <div class="custom-deck-section-header">
        <h3>My Custom Decks</h3>
        <button class="btn-create-deck" id="btn-create-custom-deck">${Icons.plus(15)}<span>New Deck</span></button>
      </div>
    `;

    if (customDecks.length === 0) {
      html += `
        <div class="empty-state small">
          <p class="empty-title">No custom decks yet</p>
          <p class="empty-subtitle">Tap "+ New Deck" to create one, then add words from the list or card view.</p>
        </div>
      `;
    } else {
      html += customDecks.map(cd => `
        <div class="deck-summary-card" data-deck-id="custom_${cd.id}">
          <div class="deck-card-top">
            <div class="deck-icon-badge custom-badge">${Icons.cards(20, '#52A1B1')}</div>
            <div class="deck-details">
              <h3 class="deck-name">${cd.name}</h3>
              <span class="deck-meta">${(cd.words || []).length} words</span>
            </div>
            <button class="btn-icon-tiny btn-delete-deck" data-deck-id="${cd.id}" title="Delete Deck">${Icons.trash(16, '#A39E93')}</button>
            <div class="deck-card-arrow">${Icons.chevronRight(18, '#8FA8AD')}</div>
          </div>
        </div>
      `).join('');
    }

    wrap.innerHTML = html;

    // Attach custom deck events
    wrap.querySelector('#btn-create-custom-deck').onclick = () => {
      this.promptCreateCustomDeck();
    };

    const openDeckInList = (deckId) => {
      this.clearSearch(false);
      this.selectedDeckId = deckId;
      this.renderDeckSelector();
      this.switchTab('list');
    };

    wrap.querySelectorAll('.deck-summary-card').forEach(cardEl => {
      cardEl.onclick = (e) => {
        if (e.target.closest('button')) return;
        const deckId = cardEl.dataset.deckId;
        if (deckId) openDeckInList(deckId);
      };
    });

    wrap.querySelectorAll('.btn-delete-deck').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.dataset.deckId;
        if (confirm('Delete this custom deck?')) {
          DeckManager.deleteCustomDeck(id);
          this.renderDeckSelector();
          this.renderCustomDecksView();
        }
      };
    });
  },

  promptCreateCustomDeck() {
    const name = prompt('Enter a name for your custom deck:');
    if (name && name.trim()) {
      DeckManager.createCustomDeck(name.trim());
      this.renderDeckSelector();
      this.renderCustomDecksView();
    }
  },

  updateCloudSyncStatus(statusData) {
    const dot = document.getElementById('cloud-sync-dot');
    const btn = document.getElementById('btn-cloud-sync');
    if (!dot) return;

    dot.className = 'sync-status-dot';
    const status = statusData.status;

    if (status === 'synced') {
      dot.classList.add('dot-synced');
      if (btn) btn.title = `Cloud Sync: Synced (${statusData.syncKey || ''})`;
    } else if (status === 'syncing') {
      dot.classList.add('dot-syncing');
      if (btn) btn.title = 'Cloud Sync: Syncing...';
    } else if (status === 'offline') {
      dot.classList.add('dot-offline');
      if (btn) btn.title = 'Cloud Sync: Offline';
    } else if (status === 'error') {
      dot.classList.add('dot-error');
      if (btn) btn.title = `Cloud Sync: ${statusData.lastError || 'Error'}`;
    } else {
      dot.classList.add('dot-unlinked');
      if (btn) btn.title = 'Cloud Sync: Not connected (Tap to set up)';
    }

    const modal = document.getElementById('cloud-sync-modal');
    if (modal && modal.classList.contains('visible')) {
      this.renderCloudSyncModal();
    }
  },

  openCloudSyncModal() {
    const modal = document.getElementById('cloud-sync-modal');
    if (!modal) return;
    this.renderCloudSyncModal();
    modal.classList.add('visible');
  },

  renderCloudSyncModal() {
    const container = document.getElementById('sync-modal-content');
    if (!container) return;

    const sync = window.SyncEngine || (typeof SyncEngine !== 'undefined' ? SyncEngine : null);
    if (!sync) {
      container.innerHTML = `<p style="padding: 24px; color: var(--text-muted); text-align: center;">Loading Cloud Sync...</p>`;
      return;
    }

    const statusData = sync.getStatus();
    const isLinked = !!statusData.syncKey;

    let badgeClass = 'badge-unlinked';
    let badgeHTML = '<span class="badge-dot dot-gray"></span> Not Connected';
    if (statusData.status === 'synced') {
      badgeClass = 'badge-synced';
      badgeHTML = '<span class="badge-dot dot-green"></span> Synced with Cloud';
    } else if (statusData.status === 'syncing') {
      badgeClass = 'badge-syncing';
      badgeHTML = '<span class="badge-dot dot-yellow"></span> Syncing with Cloud...';
    } else if (statusData.status === 'offline') {
      badgeClass = 'badge-offline';
      badgeHTML = '<span class="badge-dot dot-gray"></span> Offline';
    } else if (statusData.status === 'error') {
      badgeClass = 'badge-error';
      badgeHTML = '<span class="badge-dot dot-red"></span> Connection Error';
    }

    let timeText = 'Never';
    if (statusData.lastSyncedAt) {
      const diffSec = Math.round((Date.now() - statusData.lastSyncedAt) / 1000);
      if (diffSec < 60) timeText = 'Just now';
      else if (diffSec < 3600) timeText = `${Math.floor(diffSec / 60)} min ago`;
      else timeText = new Date(statusData.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    if (isLinked) {
      container.innerHTML = `
        <div class="sync-status-badge-wrap">
          <span class="sync-status-badge ${badgeClass}">${badgeHTML}</span>
          <span style="font-size: 11.5px; color: var(--text-muted);">Last sync: ${timeText}</span>
        </div>

        <div class="sync-key-card">
          <div class="sync-card-label">Active Sync Key</div>
          <div class="sync-key-display-box">
            <span class="sync-key-code" id="active-sync-key-val">${statusData.syncKey}</span>
            <button class="btn-copy-sync-key" id="btn-copy-sync-key">
              ${Icons.copy(15)}
              <span id="copy-sync-key-label">Copy Key</span>
            </button>
          </div>
          <p class="sync-helper-text">
            Enter this exact Sync Key on your iPhone or other devices to keep all your bookmarks and custom decks synchronized automatically.
          </p>
        </div>

        <div class="sync-action-buttons">
          <button class="btn-sync-action" id="btn-force-sync" style="flex: 1;">
            ${Icons.refresh(14, '#FFF')} Sync Now
          </button>
          <button class="btn-sync-secondary" id="btn-switch-sync-key">
            Change Key
          </button>
          <button class="btn-sync-secondary btn-sync-danger" id="btn-disconnect-sync">
            Disconnect
          </button>
        </div>

        <div class="sync-backup-footer">
          <span class="sync-backup-label">Offline File Backup:</span>
          <div class="sync-backup-btns">
            <button class="btn-sync-pill" id="btn-export-backup-json" title="Download backup JSON to computer">Export</button>
            <label class="btn-sync-pill" style="cursor: pointer;" title="Restore backup from file">
              Import
              <input type="file" id="input-import-backup-json" accept=".json" style="display: none;">
            </label>
          </div>
        </div>
      `;

      const copyBtn = container.querySelector('#btn-copy-sync-key');
      if (copyBtn) {
        copyBtn.onclick = async () => {
          await this.copyToClipboard(statusData.syncKey);
          const lbl = container.querySelector('#copy-sync-key-label');
          if (lbl) {
            lbl.textContent = 'Copied!';
            setTimeout(() => { if (lbl) lbl.textContent = 'Copy Key'; }, 1800);
          }
        };
      }

      const syncNowBtn = container.querySelector('#btn-force-sync');
      if (syncNowBtn) {
        syncNowBtn.onclick = async () => {
          syncNowBtn.disabled = true;
          syncNowBtn.textContent = 'Syncing...';
          await SyncEngine.pullFromCloud(true);
          await SyncEngine.pushToCloud();
          this.renderCloudSyncModal();
          this.showToast('Cloud sync complete!');
        };
      }

      const switchBtn = container.querySelector('#btn-switch-sync-key');
      if (switchBtn) {
        switchBtn.onclick = () => {
          this.renderCloudSyncUnlinkedView(true);
        };
      }

      const disconnectBtn = container.querySelector('#btn-disconnect-sync');
      if (disconnectBtn) {
        disconnectBtn.onclick = () => {
          if (confirm('Disconnect from this Sync Key? Your flashcards will remain saved locally on this device.')) {
            SyncEngine.disconnect();
            this.renderCloudSyncModal();
            this.showToast('Disconnected from cloud sync.');
          }
        };
      }
    } else {
      this.renderCloudSyncUnlinkedView(false);
      return;
    }

    this.bindBackupFooterEvents(container);
  },

  renderCloudSyncUnlinkedView(isSwitching = false) {
    const container = document.getElementById('sync-modal-content');
    if (!container) return;

    container.innerHTML = `
      <div class="sync-status-badge-wrap">
        <span class="sync-status-badge badge-unlinked"><span class="badge-dot dot-gray"></span> Not Connected</span>
        ${isSwitching ? `<button class="btn-sync-secondary" id="btn-cancel-switch" style="padding: 2px 8px; font-size: 11px;">Cancel</button>` : ''}
      </div>

      <p class="sync-helper-text">
        Connect your Supabase cloud database to automatically sync your bookmarks and custom decks across your Mac, iPhone, and other devices.
      </p>

      <div class="sync-choice-card">
        <div class="sync-choice-title">
          ${Icons.cards(16, 'var(--sage)')}
          <span>Enter an Existing Sync Key</span>
        </div>
        <p class="sync-helper-text">
          Already have a Sync Key from another device? Enter it here to link this device.
        </p>
        <div class="sync-input-row">
          <input type="text" class="sync-key-input" id="input-existing-sync-key" placeholder="e.g. HSK-7K4M9P" autocomplete="off" spellcheck="false">
          <button class="btn-sync-action" id="btn-connect-existing-key">Connect</button>
        </div>
        <div id="sync-connect-error" style="display: none; font-size: 12px; color: #C94A29; margin-top: 4px;"></div>
      </div>

      <div class="sync-choice-card">
        <div class="sync-choice-title">
          ${Icons.plus(16, 'var(--sage)')}
          <span>Generate a New Sync Key</span>
        </div>
        <p class="sync-helper-text">
          Creates a fresh, unique Sync Key and uploads your current flashcards to start syncing.
        </p>
        <button class="btn-sync-action" id="btn-generate-new-key" style="align-self: flex-start;">
          Generate New Key
        </button>
      </div>

      <div class="sync-backup-footer">
        <span class="sync-backup-label">Offline File Backup:</span>
        <div class="sync-backup-btns">
          <button class="btn-sync-pill" id="btn-export-backup-json" title="Download backup JSON to computer">Export</button>
          <label class="btn-sync-pill" style="cursor: pointer;" title="Restore backup from file">
            Import
            <input type="file" id="input-import-backup-json" accept=".json" style="display: none;">
          </label>
        </div>
      </div>
    `;

    if (isSwitching) {
      const cancelBtn = container.querySelector('#btn-cancel-switch');
      if (cancelBtn) {
        cancelBtn.onclick = () => this.renderCloudSyncModal();
      }
    }

    const connectBtn = container.querySelector('#btn-connect-existing-key');
    const inputKey = container.querySelector('#input-existing-sync-key');
    const errBox = container.querySelector('#sync-connect-error');

    if (connectBtn && inputKey) {
      const handleConnect = async () => {
        const val = inputKey.value.trim().toUpperCase();
        if (!val) {
          if (errBox) { errBox.style.display = 'block'; errBox.textContent = 'Please enter a Sync Key.'; }
          return;
        }

        connectBtn.disabled = true;
        connectBtn.textContent = 'Connecting...';
        if (errBox) errBox.style.display = 'none';

        const res = await SyncEngine.linkExistingKey(val);
        connectBtn.disabled = false;
        connectBtn.textContent = 'Connect';

        if (res.success) {
          this.renderCloudSyncModal();
          this.showToast(res.message);
        } else if (res.notFound) {
          if (confirm(`${res.message}\n\nWould you like to initialize cloud sync with this key using your current cards?`)) {
            await SyncEngine.createKeyWithLocalData(res.key);
            this.renderCloudSyncModal();
            this.showToast(`Cloud sync initialized with key: ${res.key}`);
          }
        } else {
          if (errBox) {
            errBox.style.display = 'block';
            errBox.textContent = res.message;
          }
        }
      };

      connectBtn.onclick = handleConnect;
      inputKey.onkeydown = (e) => {
        if (e.key === 'Enter') handleConnect();
      };
    }

    const genBtn = container.querySelector('#btn-generate-new-key');
    if (genBtn) {
      genBtn.onclick = async () => {
        genBtn.disabled = true;
        genBtn.textContent = 'Generating...';
        const res = await SyncEngine.generateNewSyncKey();
        genBtn.disabled = false;
        genBtn.textContent = 'Generate New Key';

        this.renderCloudSyncModal();
        this.showToast(`New Sync Key created: ${res.syncKey}`);
      };
    }

    this.bindBackupFooterEvents(container);
  },

  bindBackupFooterEvents(container) {
    const exportBtn = container.querySelector('#btn-export-backup-json');
    if (exportBtn) {
      exportBtn.onclick = () => {
        SyncEngine.exportBackupJson();
        this.showToast('Backup downloaded to your device!');
      };
    }

    const importInput = container.querySelector('#input-import-backup-json');
    if (importInput) {
      importInput.onchange = async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const res = await SyncEngine.importBackupJson(file);
          this.showToast(`Restored ${res.rememberCount} bookmarks & ${res.customCount} custom decks!`);
          this.renderCloudSyncModal();
        } catch (err) {
          alert('Failed to import backup: ' + err.message);
        }
        importInput.value = '';
      };
    }
  }
};

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => App.init());
} else {
  App.init();
}
