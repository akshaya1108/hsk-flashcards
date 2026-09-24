/**
 * Flashcard Study Engine
 * Handles Tinder-style swipe physics, card flipping, and round-based retry logic
 * (repeating missed cards until 0 incorrect remain before moving to the next subdeck).
 */

const FlashcardEngine = {
  // Session Configuration
  config: {
    deckId: 'hsk1',
    deckLabel: 'HSK 1',
    subdeckSize: 25,
    pullOrder: 'alphabetical',   // 'alphabetical' | 'random'
    subdeckOrder: 'random',      // 'random' | 'alphabetical'
    cardFace: 'chinese',         // 'chinese' | 'english'
    rangeStart: 1,
    rangeEnd: null
  },

  // Session State
  state: {
    poolWords: [],               // Words in the active range/deck
    currentBatchIndex: 0,        // Which batch of (e.g.) 25 words
    currentSubdeck: [],          // Active cards in current study round
    currentSubdeckOriginal: [],  // Snapshot of current batch
    incorrectWords: [],          // Words missed during current round
    isReviewRound: false,        // True if redoing incorrect cards
    reviewRoundNumber: 0,
    currentIndex: 0,
    maxEncounteredIndex: 0,      // Furthest card index reached in current round
    cardAnswers: {},             // Map of cardKey -> boolean (latest swipe answer)
    isCardRevealed: false,
    sessionComplete: false
  },

  // Gesture handling state
  gesture: {
    isDragging: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    cardEl: null,
    badgeRight: null,
    badgeLeft: null,
    threshold: 80
  },

  callbacks: {
    onCardChange: null,
    onRoundComplete: null,
    onBatchMastered: null,
    onSessionComplete: null
  },

  init(config, callbacks) {
    this.config = { ...this.config, ...config };
    this.callbacks = { ...this.callbacks, ...callbacks };
  },

  getCardKey(card) {
    if (!card) return '';
    const py = (card.pinyin || '').toLowerCase().replace(/\s+/g, '');
    return `${card.hanzi}_${py}`;
  },

  // Start study session with the loaded deck words
  startSession(deckWords) {
    let pool = [...deckWords];

    // 1. Apply Range Filter (1-based index)
    const startIdx = Math.max(1, parseInt(this.config.rangeStart) || 1);
    let endIdx = this.config.rangeEnd ? parseInt(this.config.rangeEnd) : pool.length;
    endIdx = Math.min(pool.length, Math.max(startIdx, endIdx));

    // Slice range: startIdx is 1-based, so slice from startIdx - 1 to endIdx
    pool = pool.slice(startIdx - 1, endIdx);

    // 2. Deck Pull Order
    if (this.config.pullOrder === 'random') {
      this.shuffleArray(pool);
    }

    this.state.poolWords = pool;
    this.state.currentBatchIndex = 0;
    this.state.sessionComplete = false;
    this.state.cardAnswers = {};
    this.state.maxEncounteredIndex = 0;

    this.loadNextBatch();
    this.saveSessionToStorage();
  },

  // Load next subdeck batch (e.g. cards 1-25, 26-50, etc.)
  loadNextBatch() {
    const size = parseInt(this.config.subdeckSize) || 25;
    const start = this.state.currentBatchIndex * size;
    const end = start + size;
    const batch = this.state.poolWords.slice(start, end);

    if (batch.length === 0) {
      this.state.sessionComplete = true;
      this.clearSavedSession();
      if (this.callbacks.onSessionComplete) {
        this.callbacks.onSessionComplete();
      }
      return;
    }

    this.state.currentSubdeckOriginal = [...batch];
    let cards = [...batch];

    // Subdeck order (randomize or alphabetical)
    if (this.config.subdeckOrder === 'random') {
      this.shuffleArray(cards);
    }

    this.state.currentSubdeck = cards;
    this.state.incorrectWords = [];
    this.state.isReviewRound = false;
    this.state.reviewRoundNumber = 0;
    this.state.currentIndex = 0;
    this.state.maxEncounteredIndex = 0;
    this.state.cardAnswers = {};
    this.state.isCardRevealed = false;

    this.notifyCardChange();
    this.saveSessionToStorage();
  },

  // Start redoing incorrect cards from the current batch
  startRedoIncorrect() {
    if (this.state.incorrectWords.length === 0) return;

    let reviewCards = [...this.state.incorrectWords];
    if (this.config.subdeckOrder === 'random') {
      this.shuffleArray(reviewCards);
    }

    this.state.currentSubdeck = reviewCards;
    this.state.incorrectWords = [];
    this.state.isReviewRound = true;
    this.state.reviewRoundNumber++;
    this.state.currentIndex = 0;
    this.state.maxEncounteredIndex = 0;
    this.state.cardAnswers = {};
    this.state.isCardRevealed = false;

    this.notifyCardChange();
    this.saveSessionToStorage();
  },

  // Advance to next batch after all 25 cards are mastered
  proceedToNextBatch() {
    this.state.currentBatchIndex++;
    this.loadNextBatch();
    this.saveSessionToStorage();
  },

  getCurrentCard() {
    if (this.state.currentIndex >= this.state.currentSubdeck.length) {
      return null;
    }
    return this.state.currentSubdeck[this.state.currentIndex];
  },

  getNextCard() {
    if (this.state.currentIndex + 1 >= this.state.currentSubdeck.length) {
      return null;
    }
    return this.state.currentSubdeck[this.state.currentIndex + 1];
  },

  triggerSwipeAnswer(direction) {
    if (this.isAnimating) return;
    const cardEl = document.getElementById('active-study-card');
    if (!cardEl) return;
    this.isAnimating = true;

    // 1. Instantly stamp the badge prominently onto the card with juicy bounce pop
    const badge = direction > 0
      ? cardEl.querySelector('.swipe-badge-right')
      : cardEl.querySelector('.swipe-badge-left');

    if (badge) {
      badge.style.transition = 'none';
      badge.style.opacity = '1';
      badge.style.transform = direction > 0 ? 'rotate(12deg) scale(1.28)' : 'rotate(-12deg) scale(1.28)';
      void badge.offsetWidth;
      badge.style.transition = 'transform 0.22s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
      badge.style.transform = direction > 0 ? 'rotate(12deg) scale(1)' : 'rotate(-12deg) scale(1)';
    }

    const xDistance = direction * (window.innerWidth > 500 ? 460 : window.innerWidth + 80);
    const rotation = direction * 16;

    // 2. Allow 220ms for the stamp badge to clearly establish its presence before the card glides
    setTimeout(() => {
      // 3. Smooth, relaxed, graceful glide off-screen (Apple-style cubic-bezier ease-out)
      cardEl.style.transition = 'transform 0.44s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.40s ease-in';
      cardEl.style.transform = `translate3d(${xDistance}px, 20px, 0) rotate(${rotation}deg)`;
      cardEl.style.opacity = '0';

      // 4. Smoothly scale up the underneath card into position
      const underneathCard = document.getElementById('underneath-study-card');
      if (underneathCard) {
        underneathCard.style.transition = 'transform 0.44s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.42s ease-out';
        underneathCard.style.transform = 'scale(1) translateY(0)';
        underneathCard.style.opacity = '1';
      }
    }, 220);

    // 5. Commit answer and transition to next card
    setTimeout(() => {
      this.isAnimating = false;
      if (direction > 0) {
        this.markCorrect();
      } else {
        this.markIncorrect();
      }
    }, 660);
  },

  // Card Flip / Reveal controls
  toggleCardReveal() {
    this.state.isCardRevealed = !this.state.isCardRevealed;
    this.notifyCardChange();
  },

  revealCard() {
    this.state.isCardRevealed = true;
    this.notifyCardChange();
  },

  hideCard() {
    this.state.isCardRevealed = false;
    this.notifyCardChange();
  },

  // Card Navigation controls
  canGoPrev() {
    return this.state.currentIndex > 0;
  },

  canGoNext() {
    // Only allow navigating forward up to cards already encountered in this round
    return this.state.currentIndex < this.state.maxEncounteredIndex &&
           this.state.currentIndex < this.state.currentSubdeck.length - 1;
  },

  goToPrevCard() {
    if (!this.canGoPrev()) return;
    this.state.currentIndex--;
    this.state.isCardRevealed = false;
    this.saveSessionToStorage();
    this.notifyCardChange();
  },

  goToNextCard() {
    if (!this.canGoNext()) return;
    this.state.currentIndex++;
    this.state.isCardRevealed = false;
    this.saveSessionToStorage();
    this.notifyCardChange();
  },

  // User marked card as CORRECT
  markCorrect() {
    this.handleAnswer(true);
  },

  // User marked card as WRONG (redo later in this batch)
  markIncorrect() {
    this.handleAnswer(false);
  },

  handleAnswer(isCorrect) {
    const card = this.getCurrentCard();
    if (!card) return;

    const currentKey = this.getCardKey(card);
    this.state.cardAnswers[currentKey] = isCorrect;

    // Latest swipe reconciliation:
    // If correct, remove from incorrectWords if previously added
    // If incorrect, add to incorrectWords if not already present
    if (isCorrect) {
      this.state.incorrectWords = this.state.incorrectWords.filter(w => this.getCardKey(w) !== currentKey);
    } else {
      const alreadyExists = this.state.incorrectWords.some(w => this.getCardKey(w) === currentKey);
      if (!alreadyExists) {
        this.state.incorrectWords.push(card);
      }
    }

    this.state.currentIndex++;
    this.state.maxEncounteredIndex = Math.max(this.state.maxEncounteredIndex, this.state.currentIndex);
    this.state.isCardRevealed = false;
    this.saveSessionToStorage();

    // Check if current subdeck round finished
    if (this.state.currentIndex >= this.state.currentSubdeck.length) {
      this.handleRoundFinish();
    } else {
      this.notifyCardChange();
    }
  },

  // Handle round completion: check if incorrect cards remain
  handleRoundFinish() {
    this.saveSessionToStorage();
    const isLastBatch = (this.state.currentBatchIndex + 1) * parseInt(this.config.subdeckSize) >= this.state.poolWords.length;

    if (this.state.incorrectWords.length > 0) {
      // Prompt user to redo incorrect ones or advance
      if (this.callbacks.onRoundComplete) {
        this.callbacks.onRoundComplete({
          totalInRound: this.state.currentSubdeck.length,
          correctCount: this.state.currentSubdeck.length - this.state.incorrectWords.length,
          incorrectCount: this.state.incorrectWords.length,
          incorrectWords: [...this.state.incorrectWords],
          isReviewRound: this.state.isReviewRound,
          roundNumber: this.state.reviewRoundNumber,
          isLastBatch: isLastBatch,
          batchIndex: this.state.currentBatchIndex
        });
      }
    } else {
      // 0 incorrect remain! Batch is mastered
      if (this.callbacks.onBatchMastered) {
        this.callbacks.onBatchMastered({
          batchSize: this.state.currentSubdeckOriginal.length,
          batchIndex: this.state.currentBatchIndex,
          isLastBatch: isLastBatch,
          totalPoolWords: this.state.poolWords.length,
          startWordIndex: this.state.currentSubdeckOriginal[0]?.deckIndex,
          endWordIndex: this.state.currentSubdeckOriginal[this.state.currentSubdeckOriginal.length - 1]?.deckIndex
        });
      }
    }
  },

  // Session persistence methods
  saveSessionToStorage() {
    if (this.state.sessionComplete || !this.state.poolWords || this.state.poolWords.length === 0) {
      localStorage.removeItem('hsk_saved_session');
      return;
    }
    const data = {
      config: this.config,
      state: {
        poolWords: this.state.poolWords,
        currentBatchIndex: this.state.currentBatchIndex,
        currentIndex: this.state.currentIndex,
        maxEncounteredIndex: this.state.maxEncounteredIndex !== undefined ? this.state.maxEncounteredIndex : this.state.currentIndex,
        cardAnswers: this.state.cardAnswers || {},
        currentSubdeck: this.state.currentSubdeck,
        currentSubdeckOriginal: this.state.currentSubdeckOriginal,
        incorrectWords: this.state.incorrectWords,
        isReviewRound: this.state.isReviewRound,
        reviewRoundNumber: this.state.reviewRoundNumber,
        sessionComplete: this.state.sessionComplete
      },
      savedAt: Date.now()
    };
    try {
      localStorage.setItem('hsk_saved_session', JSON.stringify(data));
      if (window.SyncEngine) window.SyncEngine.notifyChanged();
    } catch (e) {
      console.warn('Could not save study session to localStorage:', e);
    }
  },

  getSavedSession() {
    try {
      const raw = localStorage.getItem('hsk_saved_session');
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !data.config || !data.state || !data.state.poolWords || data.state.poolWords.length === 0) {
        return null;
      }
      return data;
    } catch (e) {
      return null;
    }
  },

  clearSavedSession() {
    try {
      localStorage.removeItem('hsk_saved_session');
      if (window.SyncEngine) window.SyncEngine.notifyChanged();
    } catch (e) {}
  },

  async resumeSavedSession() {
    const saved = this.getSavedSession();
    if (!saved) return false;

    this.config = { ...this.config, ...saved.config };
    this.state = {
      ...this.state,
      ...saved.state,
      maxEncounteredIndex: saved.state.maxEncounteredIndex !== undefined ? saved.state.maxEncounteredIndex : (saved.state.currentIndex || 0),
      cardAnswers: saved.state.cardAnswers || {},
      isCardRevealed: false
    };

    // Re-hydrate session cards from latest fresh database to purge any stale/old sentences
    try {
      if (this.config.deckId && typeof DeckManager !== 'undefined') {
        const freshDeckWords = await DeckManager.getDeckWords(this.config.deckId);
        if (freshDeckWords && freshDeckWords.length > 0) {
          const freshMap = new Map();
          freshDeckWords.forEach(w => {
            const py = (w.pinyin || '').toLowerCase().replace(/\s+/g, '');
            freshMap.set(`${w.hanzi}_${py}`, w);
            if (!freshMap.has(w.hanzi)) {
              freshMap.set(w.hanzi, w);
            }
          });

          const updateCard = (c) => {
            if (!c || !c.hanzi) return c;
            const py = (c.pinyin || '').toLowerCase().replace(/\s+/g, '');
            const fresh = freshMap.get(`${c.hanzi}_${py}`) || freshMap.get(c.hanzi);
            if (fresh) {
              return {
                ...fresh,
                deckIndex: c.deckIndex || fresh.deckIndex
              };
            }
            return c;
          };

          this.state.poolWords = (this.state.poolWords || []).map(updateCard);
          this.state.currentSubdeck = (this.state.currentSubdeck || []).map(updateCard);
          this.state.currentSubdeckOriginal = (this.state.currentSubdeckOriginal || []).map(updateCard);
          this.state.incorrectWords = (this.state.incorrectWords || []).map(updateCard);
          this.saveSessionToStorage();
        }
      }
    } catch (e) {
      console.warn('Could not re-hydrate session cards:', e);
    }

    if (this.state.currentIndex >= this.state.currentSubdeck.length) {
      this.handleRoundFinish();
    } else {
      this.notifyCardChange();
    }
    return true;
  },

  notifyCardChange() {
    if (this.callbacks.onCardChange) {
      const card = this.getCurrentCard();
      const currentKey = this.getCardKey(card);
      const previousAnswer = card && this.state.cardAnswers ? this.state.cardAnswers[currentKey] : undefined;

      this.callbacks.onCardChange({
        card: card,
        index: this.state.currentIndex + 1,
        total: this.state.currentSubdeck.length,
        isRevealed: this.state.isCardRevealed,
        isReviewRound: this.state.isReviewRound,
        cardFace: this.config.cardFace,
        batchNumber: this.state.currentBatchIndex + 1,
        incorrectCount: this.state.incorrectWords.length,
        canGoPrev: this.canGoPrev(),
        canGoNext: this.canGoNext(),
        previousAnswer: previousAnswer
      });
    }
  },

  shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },

  // --- Tinder Swipe Gesture Attachment ---
  attachSwipe(cardElement, onSwipeLeft, onSwipeRight) {
    if (!cardElement) return;

    this.gesture.cardEl = cardElement;
    this.gesture.badgeRight = cardElement.querySelector('.swipe-badge-right');
    this.gesture.badgeLeft = cardElement.querySelector('.swipe-badge-left');

    const onPointerDown = (e) => {
      // Ignore if clicking a button inside the card or navigation, or selecting example sentences
      if (e.target.closest('button') || e.target.closest('.card-btn') || e.target.closest('.btn-card-nav-arrow') || e.target.closest('.example-sentences-wrap') || e.target.closest('.card-example-card')) return;

      this.gesture.isDragging = true;
      this.gesture.startX = e.clientX;
      this.gesture.startY = e.clientY;
      this.gesture.currentX = e.clientX;
      this.gesture.currentY = e.clientY;

      cardElement.style.transition = 'none';
      try {
        cardElement.setPointerCapture(e.pointerId);
      } catch (err) {}
    };

    const onPointerMove = (e) => {
      if (!this.gesture.isDragging) return;

      this.gesture.currentX = e.clientX;
      this.gesture.currentY = e.clientY;

      const deltaX = this.gesture.currentX - this.gesture.startX;
      const deltaY = this.gesture.currentY - this.gesture.startY;
      const rotation = deltaX * 0.07; // subtle tilt

      cardElement.style.transform = `translate3d(${deltaX}px, ${deltaY * 0.4}px, 0) rotate(${rotation}deg)`;

      const threshold = this.gesture.threshold;

      // Real-time track underneath card scale & opacity
      const underneathCard = document.getElementById('underneath-study-card');
      if (underneathCard) {
        underneathCard.style.transition = 'none';
        const progress = Math.min(1, Math.abs(deltaX) / (threshold * 1.5));
        const scale = 0.95 + progress * 0.05;
        const translateY = (1 - progress) * 8;
        const op = 0.65 + progress * 0.35;
        underneathCard.style.transform = `scale(${scale}) translateY(${translateY}px)`;
        underneathCard.style.opacity = `${op}`;
      }

      // Update badge opacities
      if (deltaX > 10) {
        const opacity = Math.min(1, (deltaX - 10) / threshold);
        if (this.gesture.badgeRight) this.gesture.badgeRight.style.opacity = opacity;
        if (this.gesture.badgeLeft) this.gesture.badgeLeft.style.opacity = 0;
      } else if (deltaX < -10) {
        const opacity = Math.min(1, (-deltaX - 10) / threshold);
        if (this.gesture.badgeLeft) this.gesture.badgeLeft.style.opacity = opacity;
        if (this.gesture.badgeRight) this.gesture.badgeRight.style.opacity = 0;
      } else {
        if (this.gesture.badgeRight) this.gesture.badgeRight.style.opacity = 0;
        if (this.gesture.badgeLeft) this.gesture.badgeLeft.style.opacity = 0;
      }
    };

    const onPointerUp = (e) => {
      if (!this.gesture.isDragging) return;
      this.gesture.isDragging = false;
      try {
        if (cardElement.hasPointerCapture && cardElement.hasPointerCapture(e.pointerId)) {
          cardElement.releasePointerCapture(e.pointerId);
        }
      } catch (err) {}

      // If long press was triggered on character or pinyin, do not flip card
      if (window.App && (window.App.ignoreNextClick || window.App.longPressActive)) {
        this.resetCardPosition(cardElement);
        return;
      }

      const deltaX = this.gesture.currentX - this.gesture.startX;
      const deltaY = this.gesture.currentY - this.gesture.startY;
      const threshold = this.gesture.threshold;

      // Check if it was a simple tap (very small movement)
      if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) {
        this.resetCardPosition(cardElement);
        // Only flip on tap when card is unrevealed.
        // When revealed, it only flips back via the Hide button below.
        if (!this.state.isCardRevealed) {
          this.revealCard();
        }
        return;
      }

      if (deltaX > threshold) {
        // Swiped Right -> Correct
        this.animateCardExit(cardElement, 1, () => {
          if (onSwipeRight) onSwipeRight();
        }, false);
      } else if (deltaX < -threshold) {
        // Swiped Left -> Wrong
        this.animateCardExit(cardElement, -1, () => {
          if (onSwipeLeft) onSwipeLeft();
        }, false);
      } else {
        // Spring back
        this.resetCardPosition(cardElement);
      }
    };

    cardElement.onpointerdown = onPointerDown;
    cardElement.onpointermove = onPointerMove;
    cardElement.onpointerup = onPointerUp;
    cardElement.onpointercancel = onPointerUp;
  },

  animateCardExit(cardElement, direction, callback) {
    if (!cardElement) return;
    cardElement.style.transition = 'transform 0.28s cubic-bezier(0.2, 0.9, 0.3, 1), opacity 0.28s ease';
    const xDistance = direction * (window.innerWidth + 200);
    const rotation = direction * 25;
    cardElement.style.transform = `translate3d(${xDistance}px, 20px, 0) rotate(${rotation}deg)`;
    cardElement.style.opacity = '0';

    const underneathCard = document.getElementById('underneath-study-card');
    if (underneathCard) {
      underneathCard.style.transition = 'transform 0.28s cubic-bezier(0.2, 0.9, 0.3, 1), opacity 0.28s ease';
      underneathCard.style.transform = 'scale(1) translateY(0)';
      underneathCard.style.opacity = '1';
    }

    setTimeout(() => {
      if (callback) callback();
    }, 280);
  },

  resetCardPosition(cardElement) {
    if (!cardElement) return;
    cardElement.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.2s ease';
    cardElement.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
    cardElement.style.opacity = '1';
    if (this.gesture.badgeRight) {
      this.gesture.badgeRight.style.opacity = '0';
      this.gesture.badgeRight.style.transform = 'rotate(12deg) scale(1)';
    }
    if (this.gesture.badgeLeft) {
      this.gesture.badgeLeft.style.opacity = '0';
      this.gesture.badgeLeft.style.transform = 'rotate(-12deg) scale(1)';
    }

    const underneathCard = document.getElementById('underneath-study-card');
    if (underneathCard) {
      underneathCard.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.2s ease';
      underneathCard.style.transform = 'scale(0.95) translateY(8px)';
      underneathCard.style.opacity = '0.65';
    }
  }
};

window.FlashcardEngine = FlashcardEngine;

