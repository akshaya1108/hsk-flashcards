# HSK Chinese Flashcards (iOS PWA)

A minimalist, aesthetic flashcard and vocabulary study web app specifically designed and optimized for iPhone. Built with vanilla HTML5, modern CSS3, ES6 JavaScript, and offline Service Workers. Zero dependencies, zero emojis (100% clean SVG iconography).

---

## Key Features

1. **Complete HSK 2.0 & HSK 3.0 Vocabulary (10,000+ total entries)**:
   - Includes **both** the classic **HSK 2.0** (Levels 1 to 6) and the new standard **HSK 3.0** (Bands 1 to 6).
   - Every word includes **Hanzi**, tone-marked **Pinyin**, English **meanings**, and an **example sentence** (Hanzi, Pinyin, and English translation).
   - Audio pronunciation powered by Mandarin Chinese Text-to-Speech (`zh-CN`).

2. **Categorized Decks & List View with Numbering**:
   - Easily switch between main decks grouped by curriculum:
     - **HSK 2.0 (Classic)**: `Level 1` through `Level 6`, plus cumulative decks like `Level 4 (including Levels 1-4)`.
     - **HSK 3.0 (New Standard)**: `Band 1` through `Band 6`, plus cumulative decks like `Band 5 (including Bands 1-5)`.
     - **Custom & Saved**: `Remember Deck` and your own created custom decks.
   - All words in any selected deck are alphabetized by pinyin and sequentially numbered (`#1`, `#2`, `#3`...), making setting range filters intuitive.
   - Live search bar filtering by Hanzi, pinyin, or English.
   - Tapping any word opens its card detail sheet.

3. **Custom Study Setup**:
   - **Main Deck selection**: Pick individual levels, cumulative decks, or custom decks.
   - **Words per subdeck**: Choose 10, 25 (default), 50, 75, 100, or a custom number.
   - **Pull order**: Alphabetical (default) or Random from the main deck.
   - **Subdeck presentation**: Random (default) or Alphabetical.
   - **Card face**: Chinese First (recall English) or English First (recall Chinese).
   - **Advanced Range Filter**: Set start card # (e.g. `50`) and end card # (e.g. `150`). The app starts your subdecks at #50 and concludes the session after card #150!

4. **Tinder-Style Swipe Flashcards**:
   - Lone character or English definition on the front face.
   - Tap anywhere on the card (or the "Reveal" button) to reveal the complete card with example sentence.
   - **Swipe Right** -> Marks card Correct (green indicator).
   - **Swipe Left** -> Marks card for Review (coral indicator).
   - Quick one-tap bottom buttons (Wrong, Reveal, Correct) are also available.

5. **Round-Based Mastery Retry Logic (Non-Spaced Repetition)**:
   - If any cards in the 25-card subdeck are marked wrong, at the end of the batch the app prompts: *"Redo Incorrect Words (X cards)?"*.
   - Repeats those missed words until 0 incorrect remain in that batch.
   - Once all 25 words are mastered, moves seamlessly to the next batch of 25 (e.g. cards #75–#99).

6. **Remember & Custom Decks**:
   - Tap the bookmark icon on any card or list item to instantly add it to your `Remember Deck`.
   - Create custom decks in the Decks tab and organize your study lists.

7. **Aesthetic & 100% SVG**:
   - Clean, calming matcha pastel color scheme.
   - Zero emojis used across the app — all icons are pure, lightweight SVGs.

8. **100% Offline PWA**:
   - Works completely offline on your iPhone using Service Worker caching.

---

## How to Run on Your iPhone

### Step 1: Start the Server on Your Mac
Run the launcher script in terminal:
```bash
./start_server.sh
```
Or run:
```bash
python3 -m http.server 3333 --bind 0.0.0.0
```

### Step 2: Open in Safari on Your iPhone
1. Make sure your iPhone is connected to the same Wi-Fi network as your Mac.
2. Open **Safari** on your iPhone.
3. In the address bar, type your Mac's IP:
   ```text
   http://192.168.29.61:3333
   ```

### Step 3: Add to Home Screen
1. In Safari, tap the **Share** button (the square with an upward arrow at the bottom of the screen).
2. Scroll down and tap **"Add to Home Screen"**.
3. Tap **"Add"** in the top-right corner.

The app will now appear on your iPhone home screen with its custom icon. When opened, it runs full-screen like a native iOS app and works offline!
