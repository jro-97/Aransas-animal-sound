# Night Caller: A Texas Mystery

An interactive web app for exploring a mystery animal sound recorded on a rural South Texas property — and figuring out what made it.

## The Story

On the night of **February 21, 2026**, at 7:11 PM CST, a mystery animal called repeatedly from the darkness on a 15–20 acre property near **Ingleside / Aransas Pass, Texas** (Coastal Bend region). The recording is 43.79 seconds long. The calls are tonal, flat in contour, and centered precisely at **1040 Hz** — like a tuning fork from the dark.

Five suspects. One mystery. You decide.

## How to Use

1. **Open `index.html`** in any modern web browser — or visit the GitHub Pages URL.
2. Place **`mystery_call.wav`** in the same directory as `index.html` before opening.
3. Hit play, turn up the volume (or use headphones — the recording is quiet).
4. Click **Wind Filter** to cut the low-frequency wind noise. The mystery calls become dramatically clearer.
5. Use the **Jump to call** buttons to skip directly to each vocalization event.
6. Explore the **Suspect Lineup** — tap each case file to review the evidence.
7. **Cast your vote** at the bottom.

## File Structure

```
/
├── index.html        ← main app (open this)
├── style.css         ← dark theme styles
├── app.js            ← audio engine + visualizations + vote system
├── mystery_call.wav  ← the recording (add this yourself)
└── README.md
```

## Features

- **Live spectrogram** — custom FFT computed from the WAV file, warm thermal color palette
- **Waveform display** — full recording waveform with call-event markers
- **High-pass wind filter** — BiquadFilterNode at 300 Hz cuts wind noise in real time
- **Clickable call markers** — jump directly to each of the 5 call events
- **Frequency comparison chart** — SVG showing each suspect's vocal range vs. the 1040 Hz mystery call
- **Interactive suspect cards** — expandable case files for all 5 candidates
- **Vote system** — localStorage-persisted vote with reveal text for each choice
- **Keyboard shortcuts** — Space (play/pause), ←→ (seek 5s), F (filter toggle)
- **Mobile responsive** — works on phones and tablets

## The Suspects

| Rank | Species | Acoustic Match |
|------|---------|---------------|
| 1 | Ring-Tailed Lemur (*Lemur catta*) | 85% — neighbor owns pet lemurs |
| 2 | Jaguarundi (*Herpailurus yagouaroundi*) | 90% — extinct in TX since 1986 |
| 3 | Kinkajou (*Potos flavus*) | 70% — legal exotic pet in TX |
| 4 | White-Nosed Coatimundi (*Nasua narica*) | 50% — documented in Aransas Co. |
| 5 | Common Pauraque (*Nyctidromus albicollis*) | 40% — South Texas nightjar |

## Technical Notes

- **No build step** required — pure HTML / CSS / JavaScript, no npm or bundler
- **Web Audio API** for audio decoding, playback, gain control, and high-pass filtering
- **Custom Cooley-Tukey FFT** (iterative, in-place) for spectrogram computation
- **FFT size**: 2048 samples · **Spectrogram columns**: 700 · **Display range**: 0–3000 Hz
- **High-pass filter**: BiquadFilterNode, `highpass` type, 300 Hz cutoff, Q = 0.5
- **Spectrogram palette**: thermal warm (black → deep red → amber → white)
- Tested in Chrome, Firefox, Safari, and Edge

## Credits

Audio analysis performed with Python / scipy spectral analysis. Species research compiled from academic sources and field guides. App built with vanilla HTML / CSS / JS and the Web Audio API.

---

*The mystery remains open. What do you think it was?*
