import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import DATA from "./data/data.json";

type Note = { pitch: string; duration: number };
type Mode = "static" | "dynamic";

const DEFAULT_UNIT = 80; // Default width of a note with duration 1
const INITIAL_UPCOMING_COUNT = 5; // Parameter: how many notes to preview in dynamic mode
const KEYS_NEXT = ["Space", "Enter", "ArrowRight", "PageDown"];
const KEYS_PREVIOUS = ["ArrowLeft", "PageUp"];
const TRANSITION_MS = 100;

// Parse the mini-language string into Note[]
function parseSongString(song: string | undefined): Note[] {
  if (!song) return [];
  const tokens = song.trim().split(/\s+/).filter(Boolean);
  const notes = tokens.map((token) => {
    let pitch = token;
    let duration = 1;

    // barline token: '|' marks a measure boundary
    if (token === "|") {
      return { pitch: "|", duration: 0 } as Note;
    }

    if (token.includes("/")) {
      const parts = token.split("/");
      pitch = parts[0].trim();
      const denom = parseFloat(parts[1]) || 1;
      duration = 1 / denom;
    } else if (token.includes("*")) {
      const parts = token.split("*");
      pitch = parts[0].trim();
      const mult = parseFloat(parts[1]) || 1;
      duration = mult;
    } else {
      pitch = token.trim();
      duration = 1;
    }

    // If token is an explicit pause, keep it as 'pause' (no octave)
    if (pitch.trim().toLowerCase() === "pause") {
      // leave as-is, duration already set
    } else {
      // If no octave digit provided, default to octave 4 (e.g., C -> C4)
      if (!/\d$/.test(pitch)) {
        pitch = `${pitch}4`;
      }
    }

    return { pitch, duration } as Note;
  });

  // Prepend a special transparent 'start' note so every song begins with it.
  // If the first token is already 'start', don't add another.
  if (notes.length === 0) return notes;
  if (String(notes[0].pitch).toLowerCase() !== "start") {
    notes.unshift({ pitch: "start", duration: 1 });
  }

  return notes;
}

function makeNoteWithDuration(note: Note, duration: number = 1): Note {
  return { pitch: note.pitch, duration: duration };
}

export default function App() {
  // localStorage key for overrides
  const LOCAL_STORAGE_KEY = "mtp-data-override";

  // load any override from localStorage (stringified JSON)
  const [overrideRaw, setOverrideRaw] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LOCAL_STORAGE_KEY);
    } catch (e) {
      return null;
    }
  });

  // editor modal state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorContent, setEditorContent] = useState("");
  const [editorError, setEditorError] = useState<string | null>(null);

  // current effective data (either override or bundled DATA)
  const currentData = useMemo(() => {
    if (!overrideRaw) return DATA as any;
    try {
      return JSON.parse(overrideRaw);
    } catch (e) {
      alert(
        "The stored JSON data is invalid (cannot get parsed). Using default data."
      );
      return DATA as any;
    }
  }, [overrideRaw]);

  const COLOR_MAP = (currentData as any).color_mapping as Record<
    string,
    string
  >;
  const SONG_DATA = (currentData as any).songs as Record<string, string>;

  const [songKey, setSongKey] = useState<string>(Object.keys(SONG_DATA)[0]);
  const [mode, setMode] = useState<Mode>("static");
  const [upcomingCount, setUpcomingCount] = useState<number>(
    INITIAL_UPCOMING_COUNT
  );
  // following notes in the dynamic mode ignore the duration and are all same size
  const [smallFollowing, setSmallFollowing] = useState<boolean>(true);
  // whether to show the settings panel (hidden under gear)
  const [showSettings, setShowSettings] = useState<boolean>(false);
  // unit size for note width/height (user-configurable)
  const [unitSize, setUnitSize] = useState<number>(DEFAULT_UNIT);
  // whether to play audio for active notes
  const [playAudio, setPlayAudio] = useState<boolean>(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [headerVisible, setHeaderVisible] = useState(true);
  // whether to show floating bottom controls in static mode
  const [floatingControls, setFloatingControls] = useState<boolean>(false);

  // Audio refs
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const oscRef = React.useRef<OscillatorNode | null>(null);
  const gainRef = React.useRef<GainNode | null>(null);

  // SONG_DATA now maps song names -> mini-language strings
  const notes = useMemo(() => {
    const raw = (SONG_DATA as Record<string, string>)[songKey];
    return parseSongString(raw);
  }, [songKey]);

  // refs for scrolling behavior: main scroll container and per-note element refs
  const mainRef = useRef<HTMLDivElement | null>(null);
  const noteRefs = useRef<Array<HTMLDivElement | null>>([]);

  // track available width for the static grid so we can compute preferred breaks
  const [containerWidth, setContainerWidth] = useState<number>(1200);

  // ensure refs array resets when notes change
  useEffect(() => {
    noteRefs.current = [];
  }, [notes.length]);

  // update container width on resize / mount
  useEffect(() => {
    function updateWidth() {
      try {
        const container = mainRef.current as HTMLDivElement | null;
        if (!container) return setContainerWidth(1200);
        // prefer the width of the inner static grid if present
        const grid = container.querySelector(
          "[data-static-grid]"
        ) as HTMLDivElement | null;
        const w = (grid || container).clientWidth || 1200;
        setContainerWidth(Math.max(200, w));
      } catch (e) {
        setContainerWidth(1200);
      }
    }
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    if (mainRef.current) ro.observe(mainRef.current);
    window.addEventListener("resize", updateWidth);
    return () => {
      try {
        ro.disconnect();
      } catch (e) {}
      window.removeEventListener("resize", updateWidth);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainRef.current, notes.length]);

  // Compute rows for static mode, preferring barline breaks (pitch === '|')
  const rows = useMemo(() => {
    if (mode !== "static") return [[...Array(notes.length).keys()]];

    // Build measures: arrays of note indices between barlines
    const measures: number[][] = [];
    let cur: number[] = [];
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (String(n.pitch) === "|") {
        measures.push(cur);
        cur = [];
      } else {
        cur.push(i);
      }
    }
    if (cur.length > 0) measures.push(cur);

    // If the song contains any barlines, force the `start` token onto its own measure
    const hasBarlines = notes.some((n) => String(n.pitch) === "|");
    const startIdx = notes.findIndex(
      (n) => String(n.pitch).toLowerCase() === "start"
    );
    if (hasBarlines && startIdx >= 0) {
      // remove start from any existing measure it may be in
      for (const m of measures) {
        const p = m.indexOf(startIdx);
        if (p !== -1) {
          m.splice(p, 1);
          break;
        }
      }
      // insert a dedicated leading measure containing only the start token
      measures.unshift([startIdx]);
    }

    // Compute an average outer width for notes using unitSize similar to NoteCard
    const activeBorder = Math.max(Math.round(unitSize / 10), 6);
    const gap = 15; // match styles.staticGrid.gap

    const widths: number[] = notes.map((n) => {
      const dur = n.duration > 0 ? n.duration : 0.0001;
      const base = dur * unitSize;
      return base + 2 * activeBorder;
    });
    const avgWidth = widths.length
      ? widths.reduce((a, b) => a + b, 0) / widths.length
      : unitSize + 2 * activeBorder;

    const targetNotesPerRow = Math.max(
      1,
      Math.floor((containerWidth + gap) / (avgWidth + gap))
    );

    // Pack measures into rows without splitting measures when possible.
    const outRows: number[][] = [];
    let row: number[] = [];
    let rowCount = 0;
    for (const measure of measures) {
      if (measure.length === 0) {
        // empty measure: treat as a small separator, prefer to keep with current row
        continue;
      }

      // If this measure is the `start` token and the song has barlines,
      // force it to be its own row to satisfy the requirement.
      if (
        hasBarlines &&
        typeof startIdx === "number" &&
        startIdx >= 0 &&
        measure.indexOf(startIdx) !== -1
      ) {
        if (rowCount > 0) {
          outRows.push(row);
          row = [];
          rowCount = 0;
        }
        outRows.push([startIdx]);
        continue;
      }

      // if measure is larger than capacity, split it
      if (measure.length > targetNotesPerRow) {
        // flush current row first
        if (rowCount > 0) {
          outRows.push(row);
          row = [];
          rowCount = 0;
        }
        for (let s = 0; s < measure.length; s += targetNotesPerRow) {
          outRows.push(measure.slice(s, s + targetNotesPerRow));
        }
        continue;
      }

      // if measure fits in current row, append
      if (rowCount + measure.length <= targetNotesPerRow || rowCount === 0) {
        row = row.concat(measure);
        rowCount += measure.length;
      } else {
        // push current row and start new one with this measure
        outRows.push(row);
        row = [...measure];
        rowCount = measure.length;
      }
    }
    if (rowCount > 0) outRows.push(row);

    // If there are no explicit barlines (single measure equals all notes), fallback to equal chunks
    if (measures.length <= 1) {
      const flat: number[] = measures.length === 1 ? measures[0] : [];
      const fallback: number[][] = [];
      for (let i = 0; i < flat.length; i += targetNotesPerRow) {
        fallback.push(flat.slice(i, i + targetNotesPerRow));
      }
      return fallback.length ? fallback : [flat];
    }

    return outRows.length
      ? outRows
      : [Array.from({ length: notes.length }, (_, i) => i)];
  }, [notes, unitSize, containerWidth, mode]);

  // Auto-scroll when active note is in the lower part of the visible area
  useEffect(() => {
    if (mode !== "static") return;
    const container = mainRef.current;
    const activeEl = noteRefs.current[currentIndex];
    if (!container || !activeEl) return;

    const containerRect = container.getBoundingClientRect();
    const elRect = activeEl.getBoundingClientRect();

    // threshold for 'lower part of screen' — when note's bottom is below 70% of container
    const lowerThreshold = containerRect.top + containerRect.height * 0.7;
    // small padding so note isn't flush against edge
    const padding = 8;

    if (elRect.bottom > lowerThreshold) {
      const delta = elRect.bottom - lowerThreshold + padding;
      container.scrollBy({ top: delta, behavior: "smooth" });
    } else {
      // if note is too high (optional: keep it reasonably visible)
      const upperThreshold = containerRect.top + containerRect.height * 0.1;
      if (elRect.top < upperThreshold) {
        const delta = elRect.top - upperThreshold - padding;
        container.scrollBy({ top: delta, behavior: "smooth" });
      }
    }
    // include dependencies that affect layout
  }, [currentIndex, mode, notes.length, unitSize]);

  // Logic to advance to next note.
  // If in `dynamic` mode, use a brief blank transition; in `static` mode advance immediately.
  const nextNote = useCallback(() => {
    if (mode !== "dynamic") {
      setCurrentIndex((prev) => (prev < notes.length - 1 ? prev + 1 : 0));
      return;
    }
    if (isTransitioning) return;
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev < notes.length - 1 ? prev + 1 : 0));
      setIsTransitioning(false);
    }, TRANSITION_MS);
  }, [notes.length, isTransitioning, mode]);

  // Go to previous note (wrap to end if at start).
  // If in `dynamic` mode, use a brief blank transition; otherwise immediate.
  const prevNote = useCallback(() => {
    if (mode !== "dynamic") {
      setCurrentIndex((prev) => {
        if (notes.length === 0) return 0;
        return prev > 0 ? prev - 1 : notes.length - 1;
      });
      return;
    }
    if (isTransitioning) return;
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentIndex((prev) => {
        if (notes.length === 0) return 0;
        return prev > 0 ? prev - 1 : notes.length - 1;
      });
      setIsTransitioning(false);
    }, TRANSITION_MS);
  }, [notes.length, isTransitioning, mode]);

  // Reset to first note
  const resetNotes = useCallback(() => {
    setCurrentIndex(0);
  }, []);

  // Handle keyboard (Space or Enter to advance)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (KEYS_NEXT.includes(e.code)) nextNote();
      else if (KEYS_PREVIOUS.includes(e.code)) prevNote();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nextNote, prevNote]);

  // Reset index when song changes
  useEffect(() => {
    setCurrentIndex(0);
  }, [songKey]);

  // Keep settings panel open across mode switches; dynamic-only controls
  // are conditionally rendered inside the panel when `mode === 'dynamic'`.

  // When switching out of dynamic mode, cancel any pending transition
  useEffect(() => {
    if (mode !== "dynamic" && isTransitioning) setIsTransitioning(false);
  }, [mode, isTransitioning]);

  // --- Audio helpers ---
  function noteToMidiNumber(note: string): number {
    // note like C4 or A#3
    const m = String(note)
      .trim()
      .match(/^([A-Ga-g])([#b]?)(-?\d+)?$/);
    if (!m) return 60;
    const base = m[1].toUpperCase();
    const acc = m[2] || "";
    const octave = m[3] ? parseInt(m[3], 10) : 4;
    const order: Record<string, number> = {
      C: 0,
      "C#": 1,
      DB: 1,
      D: 2,
      "D#": 3,
      EB: 3,
      E: 4,
      F: 5,
      "F#": 6,
      GB: 6,
      G: 7,
      "G#": 8,
      AB: 8,
      A: 9,
      "A#": 10,
      BB: 10,
      B: 11,
    };
    const key = (base + (acc || "")).toUpperCase();
    const semitone = order[key] ?? 0;
    return 12 * (octave + 1) + semitone;
  }

  function midiNumberToFreq(n: number) {
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  function startNoteAudio(pitch: string) {
    if (!playAudio) return;
    try {
      if (!audioCtxRef.current)
        audioCtxRef.current = new (window.AudioContext ||
          (window as any).webkitAudioContext)();
      const ctx = audioCtxRef.current as AudioContext;
      // some browsers require resume on user gesture
      ctx.resume().catch(() => {});

      // stop previous
      stopNoteAudio();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      const midi = noteToMidiNumber(pitch);
      const freq = midiNumberToFreq(midi);
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      oscRef.current = osc;
      gainRef.current = gain;
    } catch (e) {
      // ignore audio errors
      console.warn("audio start error", e);
    }
  }

  function stopNoteAudio() {
    try {
      const osc = oscRef.current;
      const gain = gainRef.current;
      const ctx = audioCtxRef.current;
      if (osc && gain && ctx) {
        // ramp down quickly
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.0, ctx.currentTime + 0.05);
        try {
          osc.stop(ctx.currentTime + 0.06);
        } catch (e) {}
        osc.disconnect();
        gain.disconnect();
      }
    } catch (e) {
      /* ignore */
    } finally {
      oscRef.current = null;
      gainRef.current = null;
    }
  }

  // Play audio when currentIndex changes (keep playing until next change)
  useEffect(() => {
    if (!playAudio) return;
    const note = notes[currentIndex];
    if (!note) return;
    // do not play audio for pause notes
    const p = String(note.pitch).toLowerCase();
    if (p === "pause" || p === "start") {
      stopNoteAudio();
      return;
    }
    startNoteAudio(note.pitch);
    return () => {
      stopNoteAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, playAudio]);

  // Stop audio immediately when audio toggled off
  useEffect(() => {
    if (!playAudio) stopNoteAudio();
    else if (playAudio) {
      // start current note if any
      const n = notes[currentIndex];
      if (n) startNoteAudio(n.pitch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playAudio]);

  return (
    <div style={styles.appContainer}>
      <button
        onClick={() => setHeaderVisible((v) => !v)}
        aria-label={headerVisible ? "Hide header" : "Show header"}
        style={styles.burgerButton}
      >
        {headerVisible ? "✖" : "☰"}
      </button>
      {/* --- Header Controls --- */}
      {headerVisible && (
        <header style={styles.header}>
          <div style={styles.controlGroup}>
            <label>Song:</label>
            <select
              value={songKey}
              onChange={(e) => setSongKey(e.target.value)}
              style={styles.select}
            >
              {Object.keys(SONG_DATA).map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </div>

          <div style={styles.controlGroup}>
            <label>Mode:</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              style={styles.select}
            >
              <option value="static">Static (Scroll)</option>
              <option value="dynamic">Dynamic (Play)</option>
            </select>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={() => setShowSettings((v) => !v)}
                aria-pressed={showSettings}
                aria-label={showSettings ? "Hide settings" : "Show settings"}
                style={styles.gearButton}
              >
                ⚙
              </button>

              {showSettings && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label>Size:</label>
                  <input
                    type="number"
                    value={unitSize}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setUnitSize(Number.isFinite(v) ? v : DEFAULT_UNIT);
                    }}
                    style={styles.numberInput}
                  />
                  <label
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <input
                      type="checkbox"
                      checked={playAudio}
                      onChange={(e) => setPlayAudio(e.target.checked)}
                    />
                    <span>Audio</span>
                  </label>

                  {mode === "static" && (
                    <label
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <input
                        type="checkbox"
                        checked={floatingControls}
                        onChange={(e) => setFloatingControls(e.target.checked)}
                      />
                      <span>Floating controls</span>
                    </label>
                  )}

                  {mode === "dynamic" && (
                    <>
                      <label>Upcoming:</label>
                      <input
                        type="number"
                        min={0}
                        max={20}
                        value={upcomingCount}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setUpcomingCount(
                            Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
                          );
                        }}
                        style={styles.numberInput}
                      />
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={smallFollowing}
                          onChange={(e) => setSmallFollowing(e.target.checked)}
                        />
                        <span>Small following</span>
                      </label>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div style={styles.controlGroup}>
            <button
              style={styles.button}
              onClick={resetNotes}
              aria-label="Reset to first note"
            >
              Reset
            </button>
            <button
              style={styles.button}
              onClick={prevNote}
              aria-label="Previous note"
            >
              Back
            </button>
            <button
              style={styles.button}
              onClick={nextNote}
              aria-label="Next note"
            >
              Forward
            </button>
          </div>

          <div style={styles.rightGroup}>
            <button
              style={{ ...styles.link, marginLeft: 8 }}
              onClick={() => {
                setEditorContent(JSON.stringify(currentData, null, 2));
                setEditorError(null);
                setEditorOpen(true);
              }}
            >
              Edit Data
            </button>

            <a
              href="https://github.com/kopp/make-that-pipe-sound"
              target="_blank"
              rel="noopener noreferrer"
              style={styles.link}
            >
              About
            </a>
          </div>
        </header>
      )}

      {editorOpen && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3>Edit data.json (client-side only)</h3>
            <textarea
              style={styles.textarea}
              value={editorContent}
              onChange={(e) => setEditorContent(e.target.value)}
            />
            {editorError && <div style={styles.error}>{editorError}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                style={styles.button}
                onClick={() => {
                  try {
                    const parsed = JSON.parse(editorContent);
                    // save override
                    localStorage.setItem(
                      LOCAL_STORAGE_KEY,
                      JSON.stringify(parsed)
                    );
                    setOverrideRaw(JSON.stringify(parsed));
                    // set song key to first song if needed
                    const first = parsed?.songs && Object.keys(parsed.songs)[0];
                    if (first) setSongKey(first);
                    setEditorOpen(false);
                  } catch (err: any) {
                    setEditorError(String(err.message || err));
                  }
                }}
              >
                Save
              </button>
              <button
                style={styles.button}
                onClick={() => {
                  setEditorOpen(false);
                }}
              >
                Cancel
              </button>
              <button
                style={styles.button}
                onClick={() => {
                  localStorage.removeItem(LOCAL_STORAGE_KEY);
                  setOverrideRaw(null);
                  setEditorOpen(false);
                }}
              >
                Revert to Default
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Play Area --- */}
      <main
        ref={mainRef}
        style={{
          ...styles.main,
          alignItems: mode === "static" ? "flex-start" : "center",
          justifyContent: mode === "static" ? "flex-start" : "center",
          cursor: mode === "static" ? "default" : "pointer",
          paddingBottom:
            mode === "static" && floatingControls ? "6.5rem" : undefined,
        }}
        onClick={mode === "dynamic" ? nextNote : undefined}
      >
        {isTransitioning ? (
          <div style={styles.transitionBlank} />
        ) : mode === "static" ? (
          <div style={styles.staticGrid} data-static-grid>
            {rows.map((row, ri) => (
              <div key={ri} style={styles.row}>
                {row.map((i) => (
                  <NoteCard
                    key={i}
                    note={notes[i]}
                    isActive={i === currentIndex}
                    onClick={() => setCurrentIndex(i)}
                    colorMap={COLOR_MAP}
                    unitSize={unitSize}
                    containerRef={(el: HTMLDivElement | null) => {
                      noteRefs.current[i] = el;
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div style={styles.dynamicWrapper}>
            {/* Focus Note */}
            <NoteCard
              note={notes[currentIndex]}
              isActive={true}
              isLarge={true}
              colorMap={COLOR_MAP}
              unitSize={unitSize}
            />

            {/* Upcoming Notes */}
            <div style={styles.previewStrip}>
              {notes
                .slice(currentIndex + 1, currentIndex + 1 + upcomingCount)
                .map((note, i) => (
                  <NoteCard
                    key={i}
                    note={smallFollowing ? makeNoteWithDuration(note, 1) : note}
                    isActive={false}
                    isLarge={false}
                    colorMap={COLOR_MAP}
                    unitSize={unitSize}
                  />
                ))}
            </div>
            <div style={styles.tapPrompt}>
              Tap screen or press Space to play
            </div>
          </div>
        )}
      </main>

      {mode === "static" && floatingControls && (
        <div style={styles.floatingControlsContainer} aria-hidden={false}>
          <button style={styles.floatingButton} onClick={nextNote}>
            Forward
          </button>
          <button style={styles.floatingButton} onClick={nextNote}>
            Forward
          </button>
        </div>
      )}
    </div>
  );
}

// --- Color helpers ---
const NAMED_COLOR_MAP: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  blue: "#0000ff",
  yellow: "#ffff00",
  green: "#00ff00",
  orange: "#ffa500",
  brown: "#a52a2a",
  purple: "#800080",
  pink: "#ffc0cb",
  gray: "#808080",
  grey: "#808080",
};

function clamp(v: number, a = 0, b = 255) {
  return Math.max(a, Math.min(b, Math.round(v)));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!hex) return null;
  const h = hex.replace("#", "").trim();
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return { r, g, b };
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return { r, g, b };
  }
  return null;
}

function rgbToHex(r: number, g: number, b: number) {
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}

function lightenHex(hex: string, amount = 0.12) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const r = clamp(rgb.r + (255 - rgb.r) * amount);
  const g = clamp(rgb.g + (255 - rgb.g) * amount);
  const b = clamp(rgb.b + (255 - rgb.b) * amount);
  return rgbToHex(r, g, b);
}

function parseColorToken(token: string, appBg = "#1a1a1a") {
  // token may be 'blank', a hex like #ff0, or a named color
  const t = token.trim().toLowerCase();
  if (!t) return null;
  if (t === "blank") {
    // return a slightly lighter version of the app background
    return lightenHex(appBg, 0.12);
  }
  if (t.startsWith("#")) return t;
  if (NAMED_COLOR_MAP[t]) return NAMED_COLOR_MAP[t];
  // fallback: return the original token and let browser try to resolve it
  return token;
}

// --- Sub-component ---
function NoteCard({
  note,
  isActive,
  isLarge,
  onClick,
  colorMap,
  unitSize,
  containerRef,
}: {
  note: Note;
  isActive: boolean;
  isLarge?: boolean;
  onClick?: () => void;
  colorMap?: Record<string, string>;
  unitSize?: number;
  containerRef?: (el: HTMLDivElement | null) => void;
}) {
  const raw = (colorMap || {})[note.pitch] || "#555";
  const isStart = String(note.pitch).toLowerCase() === "start";
  const isPause = String(note.pitch).toLowerCase() === "pause";
  const tokens = String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const appBg = (styles.appContainer.backgroundColor as string) || "#1a1a1a";
  const parsed = tokens.map((t) => parseColorToken(t, appBg));
  const isMulti = parsed.length > 1;

  // determine text color by sampling the first resolved color if possible
  const sample = parsed[0] || "#555";
  let sampleRgb = hexToRgb(String(sample)) || null;
  // if sample isn't hex we try to map by name
  if (!sampleRgb && typeof sample === "string") {
    const mapped = NAMED_COLOR_MAP[(sample as string).toLowerCase()];
    sampleRgb = mapped ? hexToRgb(mapped) : null;
  }
  const luminance = sampleRgb
    ? (0.2126 * sampleRgb.r + 0.7152 * sampleRgb.g + 0.0722 * sampleRgb.b) / 255
    : 0.5;
  const isDarkColor = luminance < 0.5;
  const size = unitSize ?? DEFAULT_UNIT;
  // active border thickness (visible when active)
  const activeBorder = Math.max(Math.round(size / 10), 6);
  const inactiveBorder = Math.round(activeBorder / 3);
  // base content width/height for the note (without considering outer shell)
  const baseWidth = note.duration * (isLarge ? size * 1.5 : size);
  const baseHeight = isLarge ? Math.round(size * 3.75) : Math.round(size);
  // outer footprint width/height so active (with thicker border) and
  // inactive (with thinner border) occupy the same overall box size.
  const outerWidth = baseWidth + 2 * activeBorder;
  const outerHeight = baseHeight + 2 * activeBorder;
  const bgStyle: React.CSSProperties = {};
  if (!isMulti) {
    bgStyle.backgroundColor = parsed[0] || "#555";
  } else {
    const n = parsed.length;
    const seg = 100 / n;
    const stops = parsed
      .map((c, i) => {
        const start = (i * seg).toFixed(4);
        const end = ((i + 1) * seg).toFixed(4);
        return `${c} ${start}% ${end}%`;
      })
      .join(", ");
    bgStyle.background = `linear-gradient(to bottom, ${stops})`;
  }
  // Prevent the background from bleeding into the border area
  bgStyle.backgroundClip = "padding-box";

  // If this is a pause, render transparent background and no border
  if (isPause || isStart) {
    bgStyle.background = "transparent";
    bgStyle.backgroundColor = "transparent";
  }
  return (
    <div
      ref={containerRef}
      onClick={onClick}
      style={{
        ...styles.note,
        ...bgStyle,
        // Ensure that the NoteCard takes the same space in both active/inactive
        // states, otherwise the layout shifts while playing.
        boxSizing: "border-box",
        width: `${outerWidth}px`,
        height: `${outerHeight}px`,
        // start cards never show a border; otherwise active cards get the blue border
        borderStyle: isStart ? "none" : isActive ? "solid" : "solid",
        borderWidth: isStart
          ? "0px"
          : isActive
          ? `${activeBorder}px`
          : `${inactiveBorder}px`,
        borderColor: isStart ? undefined : isActive ? "#00d4ff" : "white",
        color: isDarkColor ? "white" : "black",
        transform: isActive ? "scale(1)" : "scale(1)",
        zIndex: isActive ? 2 : 1,
      }}
    >
      <span
        style={
          isStart
            ? {
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: isLarge ? "1.25rem" : "1rem",
                color: "white",
                position: "relative",
                zIndex: 3,
              }
            : isPause
            ? {
                fontSize: isLarge ? "2rem" : "1.25rem",
                padding: "0",
                background: "transparent",
                color: "white",
                borderRadius: "0",
                position: "relative",
                zIndex: 3,
              }
            : isMulti
            ? {
                backgroundColor: "#000",
                color: "white",
                padding: "6px 10px",
                borderRadius: "8px",
                fontSize: isLarge ? "1.5rem" : "1rem",
                fontWeight: "bold",
                // keep label above borders
                position: "relative",
                zIndex: 3,
              }
            : {
                fontSize: isLarge ? "1.5rem" : "1rem",
                fontWeight: "bold",
                position: "relative",
                zIndex: 3,
              }
        }
      >
        {isStart ? (isActive ? "→" : "") : isPause ? "🤫" : note.pitch}
      </span>
    </div>
  );
}

// --- Responsive Styles ---
const styles: Record<string, React.CSSProperties> = {
  appContainer: {
    width: "100vw",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    backgroundColor: "gray",
    color: "white",
    overflow: "hidden",
    position: "relative",
  },
  header: {
    padding: "1rem",
    paddingLeft: "3rem",
    display: "flex",
    gap: "20px",
    background: "#2a2a2a",
    borderBottom: "1px solid #444",
    flexWrap: "wrap",
  },
  controlGroup: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  select: {
    padding: "8px",
    borderRadius: "4px",
    border: "none",
    background: "#444",
    color: "white",
    fontSize: "1rem",
  },
  link: {
    color: "white",
    textDecoration: "none",
    padding: "8px 10px",
    borderRadius: "6px",
    background: "#333",
    display: "inline-block",
  },
  rightGroup: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  main: {
    flex: 1,
    padding: "2rem",
    overflowY: "auto",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    cursor: "pointer",
  },
  staticGrid: {
    display: "flex",
    flexDirection: "column",
    gap: "15px",
    justifyContent: "center",
    maxWidth: "1200px",
  },
  row: {
    display: "flex",
    gap: "15px",
    justifyContent: "center",
    marginBottom: "15px",
  },
  dynamicWrapper: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "30px",
  },
  previewStrip: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    opacity: 0.7,
  },
  tapPrompt: {
    marginTop: "20px",
    fontSize: "0.9rem",
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: "1px",
  },
  floatingControlsContainer: {
    position: "fixed",
    bottom: "12px",
    width: "97%",
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    justifyContent: "space-between",
    zIndex: 60,
    pointerEvents: "auto",
  },
  floatingButton: {
    padding: "12px 18px",
    fontSize: "1.05rem",
    borderRadius: "10px",
    border: "none",
    background: "#00d4ff",
    color: "#002a33",
    boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
    cursor: "pointer",
    touchAction: "manipulation",
  },
  note: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "12px",
    transition: "all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
    boxShadow: "0 4px 15px rgba(0,0,0,0.3)",
    userSelect: "none",
  },
  burgerButton: {
    position: "absolute",
    top: "10px",
    left: "10px",
    zIndex: 20,
    padding: "8px 10px",
    borderRadius: "6px",
    background: "#333",
    color: "white",
    border: "none",
    cursor: "pointer",
    fontSize: "1.1rem",
  },
  gearButton: {
    padding: "6px 8px",
    borderRadius: "6px",
    background: "#333",
    color: "white",
    border: "none",
    cursor: "pointer",
    fontSize: "1rem",
  },
  textarea: {
    width: "80vw",
    height: "50vh",
    fontFamily: "monospace",
    fontSize: "0.9rem",
    padding: "8px",
    borderRadius: "6px",
    border: "1px solid #444",
    background: "#111",
    color: "white",
  },
  numberInput: {
    width: "4rem",
    padding: "6px",
    borderRadius: "4px",
    border: "none",
    background: "#444",
    color: "white",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
  },
  modal: {
    background: "#222",
    padding: "1rem",
    borderRadius: "8px",
    maxWidth: "90vw",
    maxHeight: "90vh",
    overflow: "auto",
  },
  error: {
    color: "#ff6666",
    marginTop: "8px",
  },
  transitionBlank: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
};
