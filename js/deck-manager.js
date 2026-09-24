/**
 * Deck Manager module
 * Supports BOTH HSK 2.0 (Classic 6 Levels) and HSK 3.0 (New Standard 6 Bands),
 * compound decks (e.g. HSK 2.0 Level 4 including 1-4, HSK 3.0 Band 5 including 1-5),
 * custom decks, Remember deck, alphabetical sorting, and sequential indexing.
 */

const DeckManager = {
  // In-memory cache of loaded level arrays: key e.g. "2.0_1", "3.0_2"
  rawLevels: {},

  // Precomputed polyphone matrix: { '3.0': { hanzi: [...] }, '2.0': { hanzi: [...] } }
  polyphoneMap: null,

  async loadPolyphones() {
    if (this.polyphoneMap) return this.polyphoneMap;
    try {
      const res = await fetch('./data/polyphones.json?v=39');
      if (res.ok) {
        this.polyphoneMap = await res.json();
      }
    } catch (e) {
      console.warn('Could not load polyphones.json:', e);
    }
    return this.polyphoneMap;
  },

  // Cross-reference index mapping each Hanzi -> { hsk3?: number, hsk2?: number }
  levelIndex: null,

  async loadLevelIndex() {
    if (this.levelIndex) return this.levelIndex;
    try {
      const res = await fetch('./data/hsk_level_index.json?v=39');
      if (res.ok) {
        this.levelIndex = await res.json();
      }
    } catch (e) {
      console.warn('Could not load hsk_level_index.json:', e);
    }
    return this.levelIndex;
  },

  getWordHskLevels(hanzi) {
    if (!hanzi || !this.levelIndex) return null;
    return this.levelIndex[hanzi.trim()] || null;
  },

  // Clean pinyin for accurate polyphone comparison (lowercase, whitespace stripped)
  cleanPinyin(py) {
    if (!py) return '';
    return py.toLowerCase().replace(/\s+/g, '').trim();
  },

  // Check if a character is a true registered polyphone in the curriculum
  isPolyphone(hanzi) {
    if (!hanzi || !this.polyphoneMap) return false;
    const hz = hanzi.trim();
    return Boolean(
      (this.polyphoneMap['3.0'] && this.polyphoneMap['3.0'][hz]) ||
      (this.polyphoneMap['2.0'] && this.polyphoneMap['2.0'][hz])
    );
  },

  // Get all versions for a given word across the active curriculum and deck
  getWordVersions(word, contextWords = []) {
    if (!word || !word.hanzi) return [word];
    const hz = word.hanzi.trim();
    const version = word.version || '3.0';

    // 1. Strict guard: If NOT a true polyphone in the curriculum, strictly return [word]
    if (!this.isPolyphone(hz)) {
      return [word];
    }

    // 2. Fetch curated polyphone entries from master matrix
    let polyList = [];
    if (this.polyphoneMap && this.polyphoneMap[version] && this.polyphoneMap[version][hz]) {
      polyList = this.polyphoneMap[version][hz];
    } else if (this.polyphoneMap) {
      const otherV = version === '3.0' ? '2.0' : '3.0';
      if (this.polyphoneMap[otherV] && this.polyphoneMap[otherV][hz]) {
        polyList = this.polyphoneMap[otherV][hz];
      }
    }

    if (!polyList || polyList.length <= 1) {
      return [word];
    }

    // 3. Map readings strictly by distinct clean pronunciation
    const map = new Map();
    const curPy = this.cleanPinyin(word.pinyin);
    map.set(curPy, word);

    // If alternate readings exist in contextWords (e.g. cumulative deck with deckIndex), index them
    const contextByCleanPy = new Map();
    (contextWords || []).forEach(w => {
      if (w.hanzi === hz) {
        const cpy = this.cleanPinyin(w.pinyin);
        if (cpy && !contextByCleanPy.has(cpy)) {
          contextByCleanPy.set(cpy, w);
        }
      }
    });

    polyList.forEach(w => {
      const py = this.cleanPinyin(w.pinyin);
      if (py && !map.has(py)) {
        const matched = contextByCleanPy.get(py);
        if (matched) {
          map.set(py, matched);
        } else {
          map.set(py, { ...w, version: w.version || version });
        }
      }
    });

    const versions = Array.from(map.values());
    versions.sort((a, b) => (a.level || 0) - (b.level || 0));
    return versions;
  },

  // Predefined standard deck definitions
  DECK_DEFINITIONS: [
    // --- Master Vocabulary (All Words) ---
    { id: 'all_words', label: 'All Words (Master List)', version: '3.0', levels: [1, 2, 3, 4, 5, 6], group: 'Master Vocabulary', isMaster: true },

    // --- HSK 3.0 (New Standard) ---
    { id: 'hsk3_1', label: 'HSK 3.0 - Band 1', version: '3.0', levels: [1], group: 'HSK 3.0 (New Standard)' },
    { id: 'hsk3_2', label: 'HSK 3.0 - Band 2', version: '3.0', levels: [2], group: 'HSK 3.0 (New Standard)' },
    { id: 'hsk3_2_cum', label: 'HSK 3.0 - Band 2 (including Bands 1-2)', version: '3.0', levels: [1, 2], group: 'HSK 3.0 (New Standard)' },
    { id: 'hsk3_3', label: 'HSK 3.0 - Band 3', version: '3.0', levels: [3], group: 'HSK 3.0 (New Standard)' },
    { id: 'hsk3_3_cum', label: 'HSK 3.0 - Band 3 (including Bands 1-3)', version: '3.0', levels: [1, 2, 3], group: 'HSK 3.0 (New Standard)' },
    { id: 'hsk3_4', label: 'HSK 3.0 - Band 4', version: '3.0', levels: [4], group: 'HSK 3.0 (New Standard)' },
    { id: 'hsk3_4_cum', label: 'HSK 3.0 - Band 4 (including Bands 1-4)', version: '3.0', levels: [1, 2, 3, 4], group: 'HSK 3.0 (New Standard)' },
    { id: 'hsk3_5', label: 'HSK 3.0 - Band 5', version: '3.0', levels: [5], group: 'HSK 3.0 (New Standard)' },
    { id: 'hsk3_5_cum', label: 'HSK 3.0 - Band 5 (including Bands 1-5)', version: '3.0', levels: [1, 2, 3, 4, 5], group: 'HSK 3.0 (New Standard)' },
    { id: 'hsk3_6', label: 'HSK 3.0 - Band 6', version: '3.0', levels: [6], group: 'HSK 3.0 (New Standard)' },
    { id: 'hsk3_6_cum', label: 'HSK 3.0 - Band 6 (including Bands 1-6)', version: '3.0', levels: [1, 2, 3, 4, 5, 6], group: 'HSK 3.0 (New Standard)' },

    // --- HSK 2.0 (Classic) ---
    { id: 'hsk2_1', label: 'HSK 2.0 - Level 1', version: '2.0', levels: [1], group: 'HSK 2.0 (Classic)' },
    { id: 'hsk2_2', label: 'HSK 2.0 - Level 2', version: '2.0', levels: [2], group: 'HSK 2.0 (Classic)' },
    { id: 'hsk2_2_cum', label: 'HSK 2.0 - Level 2 (including Levels 1-2)', version: '2.0', levels: [1, 2], group: 'HSK 2.0 (Classic)' },
    { id: 'hsk2_3', label: 'HSK 2.0 - Level 3', version: '2.0', levels: [3], group: 'HSK 2.0 (Classic)' },
    { id: 'hsk2_3_cum', label: 'HSK 2.0 - Level 3 (including Levels 1-3)', version: '2.0', levels: [1, 2, 3], group: 'HSK 2.0 (Classic)' },
    { id: 'hsk2_4', label: 'HSK 2.0 - Level 4', version: '2.0', levels: [4], group: 'HSK 2.0 (Classic)' },
    { id: 'hsk2_4_cum', label: 'HSK 2.0 - Level 4 (including Levels 1-4)', version: '2.0', levels: [1, 2, 3, 4], group: 'HSK 2.0 (Classic)' },
    { id: 'hsk2_5', label: 'HSK 2.0 - Level 5', version: '2.0', levels: [5], group: 'HSK 2.0 (Classic)' },
    { id: 'hsk2_5_cum', label: 'HSK 2.0 - Level 5 (including Levels 1-5)', version: '2.0', levels: [1, 2, 3, 4, 5], group: 'HSK 2.0 (Classic)' },
    { id: 'hsk2_6', label: 'HSK 2.0 - Level 6', version: '2.0', levels: [6], group: 'HSK 2.0 (Classic)' },
    { id: 'hsk2_6_cum', label: 'HSK 2.0 - Level 6 (including Levels 1-6)', version: '2.0', levels: [1, 2, 3, 4, 5, 6], group: 'HSK 2.0 (Classic)' },

    // --- Saved / Custom ---
    { id: 'remember', label: 'Remember Deck', isRemember: true, group: 'Custom & Saved' }
  ],

  // Load a single HSK JSON file
  async loadLevel(version, levelNum) {
    const key = `${version}_${levelNum}`;
    if (this.rawLevels[key]) {
      return this.rawLevels[key];
    }

    try {
      const filePrefix = version === '2.0' ? 'hsk2_' : 'hsk3_';
      const response = await fetch(`./data/${filePrefix}${levelNum}.json?v=39`);
      if (!response.ok) {
        throw new Error(`Failed to load HSK ${version} Level/Band ${levelNum}`);
      }
      const data = await response.json();
      this.rawLevels[key] = data;
      return data;
    } catch (err) {
      console.error(err);
      return [];
    }
  },

  // Normalize pinyin for clean alphabetical sorting
  normalizePinyin(py) {
    if (!py) return '';
    return py
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z]/g, '')
      .toLowerCase();
  },

  // Get all deck options including user custom decks
  getAllDeckOptions() {
    const list = [...this.DECK_DEFINITIONS];
    const customDecks = this.getCustomDecks();
    customDecks.forEach(cd => {
      list.push({
        id: `custom_${cd.id}`,
        label: cd.name,
        isCustom: true,
        customId: cd.id,
        group: 'Custom & Saved'
      });
    });
    return list;
  },

  // Get words for any deck ID, sorted alphabetically and sequentially indexed
  async getDeckWords(deckId) {
    // 0. Master List (All Words across database)
    if (deckId === 'all_words') {
      const allWords = await this.getGlobalSearchPool('hsk3_6_cum');
      return this.sortAndIndexWords(allWords);
    }

    // 1. Remember Deck
    if (deckId === 'remember') {
      const rememberList = this.getRememberWords();
      return this.sortAndIndexWords(rememberList);
    }

    // 2. Custom Deck
    if (deckId.startsWith('custom_')) {
      const customId = deckId.replace('custom_', '');
      const cd = this.getCustomDeck(customId);
      const words = cd ? (cd.words || []) : [];
      return this.sortAndIndexWords(words);
    }

    // 3. Standard HSK Deck (2.0 or 3.0)
    let def = this.DECK_DEFINITIONS.find(d => d.id === deckId);
    if (!def) {
      // Legacy fallback (e.g. 'hsk1' maps to 'hsk2_1')
      if (deckId.startsWith('hsk') && !deckId.startsWith('hsk2_') && !deckId.startsWith('hsk3_')) {
        const num = deckId.replace('hsk', '').replace('_cum', '');
        const isCum = deckId.includes('_cum');
        const targetId = isCum ? `hsk2_${num}_cum` : `hsk2_${num}`;
        def = this.DECK_DEFINITIONS.find(d => d.id === targetId);
      }
      if (!def) {
        def = this.DECK_DEFINITIONS[0]; // Default to HSK 2.0 Level 1
      }
    }

    const version = def.version || '2.0';
    const levelDataArrays = await Promise.all(def.levels.map(l => this.loadLevel(version, l)));

    // Flatten and deduplicate by Hanzi + Clean Pinyin (preserving all true polyphone readings)
    const map = new Map();
    levelDataArrays.forEach(arr => {
      arr.forEach(word => {
        const py = this.cleanPinyin(word.pinyin);
        const key = `${word.hanzi}_${py}`;
        if (!map.has(key)) {
          map.set(key, word);
        }
      });
    });

    const combined = Array.from(map.values());
    return this.sortAndIndexWords(combined);
  },

  // Sort alphabetically by pinyin and assign sequential 1-based deckIndex
  sortAndIndexWords(words) {
    const sorted = [...words].sort((a, b) => {
      const pyA = a.pinyin_sort || this.normalizePinyin(a.pinyin);
      const pyB = b.pinyin_sort || this.normalizePinyin(b.pinyin);
      if (pyA < pyB) return -1;
      if (pyA > pyB) return 1;
      return (a.hanzi || '').localeCompare(b.hanzi || '');
    });

    return sorted.map((w, idx) => ({
      ...w,
      deckIndex: idx + 1 // 1-based index matching list view & range filters
    }));
  },

  // Unified Global Search Pool across entire vocabulary database
  globalSearchPool: null,

  async getGlobalSearchPool(activeDeckId) {
    if (this.globalSearchPool) {
      return this.globalSearchPool;
    }

    const is3 = Boolean(activeDeckId && activeDeckId.startsWith('hsk3_'));
    const primaryId = is3 ? 'hsk3_6_cum' : 'hsk2_6_cum';
    const secondaryId = is3 ? 'hsk2_6_cum' : 'hsk3_6_cum';

    const [primaryWords, secondaryWords] = await Promise.all([
      this.getDeckWords(primaryId),
      this.getDeckWords(secondaryId)
    ]);

    const masterMap = new Map();
    (primaryWords || []).forEach(w => {
      const py = this.cleanPinyin(w.pinyin);
      const key = `${w.hanzi}_${py}`;
      if (!masterMap.has(key)) {
        masterMap.set(key, w);
      }
    });

    (secondaryWords || []).forEach(w => {
      const py = this.cleanPinyin(w.pinyin);
      const key = `${w.hanzi}_${py}`;
      if (!masterMap.has(key)) {
        masterMap.set(key, w);
      }
    });

    const combined = Array.from(masterMap.values());
    this.globalSearchPool = this.sortAndIndexWords(combined);
    return this.globalSearchPool;
  },

  // --- Remember Deck Storage ---
  getRememberWords() {
    try {
      const data = localStorage.getItem('hsk_remember_deck');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  isRemembered(hanzi) {
    const list = this.getRememberWords();
    return list.some(w => w.hanzi === hanzi);
  },

  toggleRemember(word) {
    if (!word || !word.hanzi) return false;
    let list = this.getRememberWords();
    const idx = list.findIndex(w => w.hanzi === word.hanzi);
    let isNowRemembered = false;

    if (idx >= 0) {
      list.splice(idx, 1);
      isNowRemembered = false;
    } else {
      list.push({
        hanzi: word.hanzi,
        pinyin: word.pinyin,
        pinyin_sort: word.pinyin_sort || this.normalizePinyin(word.pinyin),
        level: word.level,
        version: word.version || '2.0',
        meaning: word.meaning,
        example: word.example
      });
      isNowRemembered = true;
    }

    try {
      localStorage.setItem('hsk_remember_deck', JSON.stringify(list));
      if (window.SyncEngine) window.SyncEngine.notifyChanged();
    } catch (e) {
      console.error('Failed to save remember deck:', e);
    }

    return isNowRemembered;
  },

  // --- Custom Decks Storage ---
  getCustomDecks() {
    try {
      const data = localStorage.getItem('hsk_custom_decks');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  getCustomDeck(id) {
    const decks = this.getCustomDecks();
    return decks.find(d => d.id === id) || null;
  },

  saveCustomDecks(decks) {
    try {
      localStorage.setItem('hsk_custom_decks', JSON.stringify(decks));
      if (window.SyncEngine) window.SyncEngine.notifyChanged();
    } catch (e) {
      console.error('Failed to save custom decks:', e);
    }
  },

  createCustomDeck(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    const decks = this.getCustomDecks();
    const newDeck = {
      id: 'd_' + Date.now(),
      name: trimmed,
      createdAt: new Date().toISOString(),
      words: []
    };
    decks.push(newDeck);
    this.saveCustomDecks(decks);
    return newDeck;
  },

  deleteCustomDeck(id) {
    const decks = this.getCustomDecks().filter(d => d.id !== id);
    this.saveCustomDecks(decks);
  },

  addWordToCustomDeck(deckId, word) {
    if (!word || !word.hanzi) return false;
    const decks = this.getCustomDecks();
    const deck = decks.find(d => d.id === deckId);
    if (!deck) return false;

    if (!deck.words.some(w => w.hanzi === word.hanzi)) {
      deck.words.push({
        hanzi: word.hanzi,
        pinyin: word.pinyin,
        pinyin_sort: word.pinyin_sort || this.normalizePinyin(word.pinyin),
        level: word.level,
        version: word.version || '2.0',
        meaning: word.meaning,
        example: word.example
      });
      this.saveCustomDecks(decks);
      return true;
    }
    return false;
  },

  removeWordFromCustomDeck(deckId, hanzi) {
    const decks = this.getCustomDecks();
    const deck = decks.find(d => d.id === deckId);
    if (!deck) return false;
    deck.words = deck.words.filter(w => w.hanzi !== hanzi);
    this.saveCustomDecks(decks);
    return true;
  }
};

window.DeckManager = DeckManager;

