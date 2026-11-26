3# SmartCalc — Private Messenger User Manual

SmartCalc is a cross-platform (Android & iOS) encrypted messaging app disguised as a working calculator. Zero messages or chat titles are stored on your device disk.

---

## 1. Secret Access Codes

| Where to Enter | Default Code | Action |
| :--- | :--- | :--- |
| **Calculator Keypad** | `7391=` | Unlocks the private messaging vault (Sign In / Chats) |
| **Calculator Keypad** | `0000=` | Opens **Decoy Notes** (safe cover screen if someone asks to see what's inside) |
| **Calculator Keypad** | `9111=` | **Duress Code:** Opens an empty decoy vault (or silently wipes data if configured) |
| **Chats Search Bar** | `9999` | Reveals **Hidden Chats** |
| **Android Phone Dialer** | `*#*#7391#*#*` | Launches SmartCalc directly *(standalone Android APK only)* |

> **Tip:** All 4 codes above (`7391`, `0000`, `9111`, `9999`) can be customized anytime under **`⋮` > Stealth settings**. All normal calculator math (`+`, `-`, `×`, `÷`, `%`, `+/-`, `.`) works normally.

---

## 2. First-Time Login

1. Open **SmartCalc**.
2. On the calculator keypad, tap **`7` `3` `9` `1` `=`**.
3. Sign in with your private email & password (`maazahmed@gmail.com` or `farnaz@gmail.com`).
4. Once logged in, your session stays active until you sign out or run a Panic Wipe.

---

## 3. Starting a Chat & Sending Messages

1. On the **Chats** screen, tap the **green chat button** (bottom-right) or tap **`⋮` > New chat**.
2. Enter a conversation name (e.g., `Farnaz`) and tap **Create**.
3. Type your message and tap **Send**:
   - **Encrypted Photos:** Tap the paperclip icon (`📎`) to pick a photo from your library — it is compressed, encrypted client-side, and auto-burns on read with zero disk storage. Tap any photo in chat for full-screen preview.
   - **Emoji Bar & Scroll Button:** Tap the smiley icon (`😊`) to open the quick emoji bar. When scrolled up in a chat, tap the floating **`↓`** button to jump to the latest message.
   - **Long-Press Message Menu:** Press and hold any message bubble to **Reply** (quote), **Copy**, or **Unsend (Delete for Both)** immediately.
   - **Ephemeral Presence:** See `online` and `typing...` in the chat header via WebSocket memory (zero database writes).
   - **Synced Burn Countdown:** Once the recipient reads a burn-on-read message, both sender and receiver see the live `🔥 8s...` countdown before permanent deletion.
   - **Disguised Alerts:** Incoming messages outside the active chat trigger harmless calculator notifications (e.g., *"Memory register cleared."*) with zero sender or message details.

---

## 4. Per-Chat Privacy Options (Long-Press Any Chat)

Press and hold any conversation in the **Chats** list to open its options:

* **Hide / Unhide Chat:** Removes the chat from the main list. Type **`9999`** in the search bar to reveal hidden chats.
* **Set / Remove 4-Digit PIN:** Protects that specific chat with a 4-digit SHA-256 hashed PIN.
  * *Anti-Intrusion Lockout:* **3 wrong PIN attempts** trigger a **1-hour lockout** and return to the calculator.
* **Disappear Timer:** Cycle message expiration between **`10s`**, **`1m`**, **`1h`**, and **`24h`**.
* **Burn on Read (Default ON):** When the recipient reads an incoming message, an **8-second countdown** starts and permanently deletes the message from Supabase.
* **Delete Chat:** Permanently deletes the conversation and all its messages.

---

## 5. Emergency Panic Lock & Wipe

* **Instant Panic Lock:** Any of the following immediately wipes decrypted messages from memory and returns to the calculator:
  1. Tapping the **Lock icon** (`🔒`) at the top right.
  2. Switching apps or pressing Home (app goes to background).
  3. Holding the phone **face-down for 1 full second** (or a sharp shake) while inside the vault.
* **Panic Wipe All Data:** Tap **`⋮` > Panic Wipe All Data** on the Chats screen to permanently erase all threads and messages from Supabase, sign out, and lock the app.

---

## 6. Installing & Updating

### Android (`.apk`)
* Download and install the latest `.apk` from your EAS Build link.

### iOS (`.ipa` or Expo Go)
* **Option A — Standalone `.ipa` (via GitHub Actions):**
  1. Download `SmartCalc-unsigned-ipa` from your GitHub repository's **Actions** tab (**Artifacts** section).
  2. Sign and install it on your iPhone using **Sideloadly** (free personal Apple ID via USB) or a signing service.
* **Option B — Instant Live Run (Expo Go):**
  1. Install **Expo Go** from the App Store.
  2. Run `npx.cmd expo start --tunnel` on your PC and scan the QR code with the iPhone Camera.
