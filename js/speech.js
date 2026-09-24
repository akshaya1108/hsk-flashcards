/**
 * Speech synthesis module for Mandarin Chinese pronunciation
 */

const ChineseSpeech = {
  voice: null,
  isSupported: 'speechSynthesis' in window,

  init() {
    if (!this.isSupported) return;
    
    const updateVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      // Look for zh-CN or zh voices
      this.voice = voices.find(v => v.lang === 'zh-CN' || v.lang === 'zh_CN') ||
                   voices.find(v => v.lang.startsWith('zh')) || null;
    };

    updateVoice();
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = updateVoice;
    }
  },

  speak(text) {
    if (!this.isSupported || !text) return;

    try {
      window.speechSynthesis.cancel(); // Stop any pending utterance
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = 0.85; // Slightly slower for language learners
      if (this.voice) {
        utterance.voice = this.voice;
      }
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('Speech synthesis error:', e);
    }
  },

  stop() {
    if (this.isSupported) {
      window.speechSynthesis.cancel();
    }
  }
};

ChineseSpeech.init();
