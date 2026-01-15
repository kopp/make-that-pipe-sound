import React, { useState, useEffect, useCallback, useMemo } from "react";
import DATA from "./data/data.json";

type Note = { pitch: string; duration: number };
type Mode = "static" | "dynamic";

const BASE_UNIT = 80; // Width of a note with duration 1
const INITIAL_UPCOMING_COUNT = 5; // Parameter: how many notes to preview in dynamic mode
const KEYS_NEXT = ["Space", "Enter", "ArrowRight", "PageDown"];
const KEYS_PREVIOUS = ["ArrowLeft", "PageUp"];
const TRANSITION_MS = 100;

// Parse the mini-language string into Note[]
function parseSongString(song: string | undefined): Note[] {
  if (!song) return [];
  return song
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      let pitch = token;
      let duration = 1;

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

      // If no octave digit provided, default to octave 4 (e.g., C -> C4)
      if (!/\d$/.test(pitch)) {
        pitch = `${pitch}4`;
      }

      return { pitch, duration } as Note;
    });
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
  // whether to show the detailed dynamic-mode controls (hidden under gear)
  const [showDynamicDetails, setShowDynamicDetails] = useState<boolean>(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [headerVisible, setHeaderVisible] = useState(true);

  // SONG_DATA now maps song names -> mini-language strings
  const notes = useMemo(() => {
    const raw = (SONG_DATA as Record<string, string>)[songKey];
    return parseSongString(raw);
  }, [songKey]);

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

  // hide dynamic details when leaving dynamic mode
  useEffect(() => {
    if (mode !== "dynamic") setShowDynamicDetails(false);
  }, [mode]);

  // When switching out of dynamic mode, cancel any pending transition
  useEffect(() => {
    if (mode !== "dynamic" && isTransitioning) setIsTransitioning(false);
  }, [mode, isTransitioning]);

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
            {mode === "dynamic" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  onClick={() => setShowDynamicDetails((v) => !v)}
                  aria-pressed={showDynamicDetails}
                  aria-label={
                    showDynamicDetails
                      ? "Hide dynamic settings"
                      : "Show dynamic settings"
                  }
                  style={styles.gearButton}
                >
                  ⚙
                </button>
                {showDynamicDetails && (
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
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
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <input
                        type="checkbox"
                        checked={smallFollowing}
                        onChange={(e) => setSmallFollowing(e.target.checked)}
                      />
                      <span>Small following</span>
                    </label>
                  </div>
                )}
              </div>
            )}
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
        style={{
          ...styles.main,
          alignItems: mode === "static" ? "flex-start" : "center",
          justifyContent: mode === "static" ? "flex-start" : "center",
          cursor: mode === "static" ? "default" : "pointer",
        }}
        onClick={mode === "dynamic" ? nextNote : undefined}
      >
        {isTransitioning ? (
          <div style={styles.transitionBlank} />
        ) : mode === "static" ? (
          <div style={styles.staticGrid}>
            {notes.map((note, i) => (
              <NoteCard
                key={i}
                note={note}
                isActive={i === currentIndex}
                onClick={() => setCurrentIndex(i)}
                colorMap={COLOR_MAP}
              />
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
                  />
                ))}
            </div>
            <div style={styles.tapPrompt}>
              Tap screen or press Space to play
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// --- Sub-component ---
function NoteCard({
  note,
  isActive,
  isLarge,
  onClick,
  colorMap,
}: {
  note: Note;
  isActive: boolean;
  isLarge?: boolean;
  onClick?: () => void;
  colorMap?: Record<string, string>;
}) {
  const color = (colorMap || {})[note.pitch] || "#555";
  const isDarkColor = color === "black" || color === "red" || color === "blue";

  return (
    <div
      onClick={onClick}
      style={{
        ...styles.note,
        backgroundColor: color,
        width: `${note.duration * (isLarge ? BASE_UNIT * 1.5 : BASE_UNIT)}px`,
        height: isLarge ? "300px" : "80px",
        // Size of the borders needs to be the same to ensure that the NoteCard
        // takes the same space in both active/inactive states, otherwise the
        // layout shifts while playing.
        border: isActive
          ? "15px solid #00d4ff"
          : "15px solid rgba(255,255,255,0.1)",
        color: isDarkColor ? "white" : "black",
        transform: isActive ? "scale(1.05)" : "scale(1)",
        zIndex: isActive ? 2 : 1,
      }}
    >
      <span
        style={{ fontSize: isLarge ? "1.5rem" : "1rem", fontWeight: "bold" }}
      >
        {note.pitch}
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
    backgroundColor: "#1a1a1a",
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
    flexWrap: "wrap",
    gap: "15px",
    justifyContent: "center",
    maxWidth: "1200px",
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
