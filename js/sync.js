/**
 * Supabase Cloud Sync Engine for HSK Flashcards PWA
 * Provides real-time multi-device synchronization with offline-first local storage
 */

const SUPABASE_CONFIG = {
  url: 'https://pcrpkimoqjyiylqhvupi.supabase.co',
  anonKey: 'sb_publishable_fl3wnSEbffUyWn8mtPhGTQ_mOrdkh32',
  table: 'user_sync'
};

const SyncEngine = {
  syncKey: null,
  status: 'unlinked', // 'unlinked' | 'synced' | 'syncing' | 'error' | 'offline'
  lastSyncedAt: null,
  lastError: null,
  _debounceTimer: null,
  _statusListeners: [],

  init() {
    this.syncKey = localStorage.getItem('hsk_sync_key') || null;
    const savedTime = localStorage.getItem('hsk_last_synced_at');
    this.lastSyncedAt = savedTime ? parseInt(savedTime, 10) : null;

    if (!navigator.onLine) {
      this.status = 'offline';
    } else if (this.syncKey) {
      this.status = 'synced';
    } else {
      this.status = 'unlinked';
    }

    // Monitor online/offline status
    window.addEventListener('online', () => {
      if (this.syncKey) {
        this.setStatus('syncing');
        this.pullFromCloud().catch(() => {});
      } else {
        this.setStatus('unlinked');
      }
    });

    window.addEventListener('offline', () => {
      this.setStatus('offline');
    });

    // Automatically check for updates when returning to the tab
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine && this.syncKey) {
        this.pullFromCloud().catch(() => {});
      }
    });

    // If online and linked, perform background pull on launch
    if (this.syncKey && navigator.onLine) {
      setTimeout(() => {
        this.pullFromCloud().catch(() => {});
      }, 800);
    }

    this.notifyStatusListeners();
  },

  onStatusChange(listener) {
    if (typeof listener === 'function') {
      this._statusListeners.push(listener);
      listener(this.getStatus());
    }
  },

  notifyStatusListeners() {
    const statusData = this.getStatus();
    this._statusListeners.forEach(fn => {
      try {
        fn(statusData);
      } catch (e) {
        console.warn('Sync status listener error:', e);
      }
    });
  },

  setStatus(status, errorMsg = null) {
    this.status = status;
    this.lastError = errorMsg;
    this.notifyStatusListeners();
  },

  getStatus() {
    return {
      status: this.status,
      syncKey: this.syncKey,
      lastSyncedAt: this.lastSyncedAt,
      lastError: this.lastError,
      isOnline: navigator.onLine
    };
  },

  /**
   * Generates a new unique human-friendly Sync Key and seeds local data to Supabase
   */
  async generateNewSyncKey() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = 'HSK-';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    this.syncKey = code;
    localStorage.setItem('hsk_sync_key', code);
    this.setStatus('syncing');

    // Immediately push current local data to seed the cloud record
    const result = await this.pushToCloud();
    return {
      syncKey: code,
      ...result
    };
  },

  /**
   * Connects this device to an existing Sync Key and downloads data
   */
  async linkExistingKey(rawKey) {
    if (!rawKey || !rawKey.trim()) {
      return { success: false, message: 'Please enter a valid Sync Key.' };
    }

    const key = rawKey.trim().toUpperCase();
    if (!navigator.onLine) {
      return { success: false, message: 'You are currently offline. Please connect to the internet to link your Sync Key.' };
    }

    this.setStatus('syncing');

    try {
      const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/${SUPABASE_CONFIG.table}?sync_key=eq.${encodeURIComponent(key)}&select=*`, {
        headers: {
          'apikey': SUPABASE_CONFIG.anonKey,
          'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`
        }
      });

      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 403 || errText.includes('policy')) {
          this.setStatus('error', 'Database setup required');
          return {
            success: false,
            message: 'Database permission error. Please run the SQL setup script in your Supabase dashboard to enable access.'
          };
        }
        throw new Error(`Server returned ${res.status}: ${errText}`);
      }

      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        // Record does not exist in cloud yet
        this.setStatus('unlinked');
        return {
          success: false,
          notFound: true,
          key,
          message: `Sync Key "${key}" was not found in the cloud. Check spelling, or tap "Create Cloud Deck" with this key.`
        };
      }

      const record = rows[0];
      this.syncKey = key;
      localStorage.setItem('hsk_sync_key', key);

      // Apply cloud data to local storage
      this._applyCloudRecord(record);

      this.lastSyncedAt = record.updated_at ? new Date(record.updated_at).getTime() : Date.now();
      localStorage.setItem('hsk_last_synced_at', String(this.lastSyncedAt));
      this.setStatus('synced');

      return {
        success: true,
        message: `Successfully connected to ${key}! Restored ${record.remember_deck ? record.remember_deck.length : 0} bookmarks and ${record.custom_decks ? record.custom_decks.length : 0} custom decks.`
      };
    } catch (err) {
      console.error('Error linking sync key:', err);
      this.setStatus('error', err.message);
      return { success: false, message: `Could not connect to cloud: ${err.message}` };
    }
  },

  /**
   * Creates/seeds the cloud record with a specified key
   */
  async createKeyWithLocalData(key) {
    this.syncKey = key;
    localStorage.setItem('hsk_sync_key', key);
    return await this.pushToCloud();
  },

  /**
   * Disconnects cloud sync (preserves all local data on the device)
   */
  disconnect() {
    this.syncKey = null;
    localStorage.removeItem('hsk_sync_key');
    localStorage.removeItem('hsk_last_synced_at');
    this.lastSyncedAt = null;
    this.setStatus('unlinked');
  },

  /**
   * Called by DeckManager whenever bookmarks, custom decks, or sessions change
   */
  notifyChanged() {
    if (!this.syncKey || !navigator.onLine) return;

    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }

    this._debounceTimer = setTimeout(() => {
      this.pushToCloud().catch(err => console.warn('Background sync error:', err));
    }, 1200);
  },

  /**
   * Upserts local data to Supabase
   */
  async pushToCloud() {
    if (!this.syncKey) return { success: false, message: 'No Sync Key set' };
    if (!navigator.onLine) {
      this.setStatus('offline');
      return { success: false, message: 'Device is offline' };
    }

    this.setStatus('syncing');

    try {
      const payload = {
        sync_key: this.syncKey,
        remember_deck: (window.DeckManager && DeckManager.rememberDeck) || JSON.parse(localStorage.getItem('hsk_remember_deck') || '[]'),
        custom_decks: (window.DeckManager && DeckManager.customDecks) || JSON.parse(localStorage.getItem('hsk_custom_decks') || '[]'),
        saved_session: JSON.parse(localStorage.getItem('hsk_saved_session') || 'null'),
        last_deck_id: (window.App && App.selectedDeckId) || 'all_words',
        updated_at: new Date().toISOString()
      };

      const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/${SUPABASE_CONFIG.table}`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_CONFIG.anonKey,
          'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 403 || errText.includes('policy')) {
          this.setStatus('error', 'Database setup required');
          return {
            success: false,
            message: 'Database permission error. Please run the SQL setup script in your Supabase dashboard to enable access.'
          };
        }
        throw new Error(`Sync push failed: ${res.status} ${errText}`);
      }

      this.lastSyncedAt = Date.now();
      localStorage.setItem('hsk_last_synced_at', String(this.lastSyncedAt));
      this.setStatus('synced');
      return { success: true };
    } catch (err) {
      console.error('pushToCloud error:', err);
      this.setStatus('error', err.message);
      return { success: false, message: err.message };
    }
  },

  /**
   * Pulls latest data from Supabase and applies if newer than local
   */
  async pullFromCloud(force = false) {
    if (!this.syncKey || !navigator.onLine) return { success: false };

    try {
      const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/${SUPABASE_CONFIG.table}?sync_key=eq.${encodeURIComponent(this.syncKey)}&select=*`, {
        headers: {
          'apikey': SUPABASE_CONFIG.anonKey,
          'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`
        }
      });

      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 403 || errText.includes('policy')) {
          this.setStatus('error', 'Database setup required');
          return { success: false, message: 'Database setup required in Supabase' };
        }
        throw new Error(`Sync pull failed: ${res.status}`);
      }

      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        return { success: false, message: 'No cloud record found' };
      }

      const record = rows[0];
      const cloudTime = record.updated_at ? new Date(record.updated_at).getTime() : 0;
      const localTime = this.lastSyncedAt || 0;

      // Apply if cloud timestamp is newer or force flag is on
      if (force || cloudTime > localTime) {
        this._applyCloudRecord(record);
        this.lastSyncedAt = cloudTime || Date.now();
        localStorage.setItem('hsk_last_synced_at', String(this.lastSyncedAt));
      }

      this.setStatus('synced');
      return { success: true };
    } catch (err) {
      console.error('pullFromCloud error:', err);
      if (this.status !== 'offline') {
        this.setStatus('error', err.message);
      }
      return { success: false, message: err.message };
    }
  },

  _applyCloudRecord(record) {
    if (record.remember_deck) {
      localStorage.setItem('hsk_remember_deck', JSON.stringify(record.remember_deck));
      if (window.DeckManager) DeckManager.rememberDeck = record.remember_deck;
    }

    if (record.custom_decks) {
      localStorage.setItem('hsk_custom_decks', JSON.stringify(record.custom_decks));
      if (window.DeckManager) DeckManager.customDecks = record.custom_decks;
    }

    if (record.saved_session !== undefined) {
      if (record.saved_session) {
        localStorage.setItem('hsk_saved_session', JSON.stringify(record.saved_session));
      } else {
        localStorage.removeItem('hsk_saved_session');
      }
    }

    // Refresh UI components
    if (window.App) {
      try {
        App.renderDeckSelector();
        if (App.activeTab === 'custom') {
          App.renderCustomDecksView();
        } else if (App.activeTab === 'list') {
          App.loadDeck(App.selectedDeckId || 'all_words');
        }
      } catch (e) {
        console.warn('Error refreshing App after sync:', e);
      }
    }
  },

  /**
   * One-click manual backup download (JSON file)
   */
  exportBackupJson() {
    const data = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      syncKey: this.syncKey,
      rememberDeck: (window.DeckManager && DeckManager.rememberDeck) || JSON.parse(localStorage.getItem('hsk_remember_deck') || '[]'),
      customDecks: (window.DeckManager && DeckManager.customDecks) || JSON.parse(localStorage.getItem('hsk_custom_decks') || '[]'),
      savedSession: JSON.parse(localStorage.getItem('hsk_saved_session') || 'null')
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `hsk_flashcards_backup_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  /**
   * One-click manual restore from JSON file
   */
  async importBackupJson(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('No file selected'));

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (!data || (!data.rememberDeck && !data.customDecks)) {
            throw new Error('Invalid backup file format.');
          }

          if (data.rememberDeck) {
            localStorage.setItem('hsk_remember_deck', JSON.stringify(data.rememberDeck));
            if (window.DeckManager) DeckManager.rememberDeck = data.rememberDeck;
          }

          if (data.customDecks) {
            localStorage.setItem('hsk_custom_decks', JSON.stringify(data.customDecks));
            if (window.DeckManager) DeckManager.customDecks = data.customDecks;
          }

          if (data.savedSession) {
            localStorage.setItem('hsk_saved_session', JSON.stringify(data.savedSession));
          }

          if (data.syncKey && !this.syncKey) {
            this.syncKey = data.syncKey;
            localStorage.setItem('hsk_sync_key', data.syncKey);
          }

          if (window.App) {
            App.renderDeckSelector();
            if (App.activeTab === 'custom') App.renderCustomDecksView();
            else if (App.activeTab === 'list') App.loadDeck(App.selectedDeckId || 'all_words');
          }

          // Push restored data to cloud if key exists
          if (this.syncKey && navigator.onLine) {
            this.pushToCloud().catch(() => {});
          }

          resolve({
            success: true,
            rememberCount: (data.rememberDeck || []).length,
            customCount: (data.customDecks || []).length
          });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file.'));
      reader.readAsText(file);
    });
  }
};

window.SyncEngine = SyncEngine;

