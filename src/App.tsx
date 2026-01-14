import React, { useState, useEffect, useCallback, useMemo } from "react";
import COLOR_MAP from "./data/mapping.json";
import SONG_DATA from "./data/songs.json";

type Note = { pitch: string; duration: number };
type Mode = "static" | "dynamic";

const BASE_UNIT = 80; // Width of a note with duration 1
const UPCOMING_COUNT = 3; // Parameter: how many notes to preview in dynamic mode

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

export default function App() {
  const [songKey, setSongKey] = useState<string>(Object.keys(SONG_DATA)[0]);
  const [mode, setMode] = useState<Mode>("dynamic");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [headerVisible, setHeaderVisible] = useState(true);

  // SONG_DATA now maps song names -> mini-language strings
  const notes = useMemo(() => {
    const raw = (SONG_DATA as Record<string, string>)[songKey];
    return parseSongString(raw);
  }, [songKey]);

  // Logic to advance to next note
  const nextNote = useCallback(() => {
    setCurrentIndex((prev) => (prev < notes.length - 1 ? prev + 1 : 0));
  }, [notes.length]);

  // Go to previous note (wrap to end if at start)
  const prevNote = useCallback(() => {
    setCurrentIndex((prev) => {
      if (notes.length === 0) return 0;
      return prev > 0 ? prev - 1 : notes.length - 1;
    });
  }, [notes.length]);

  // Reset to first note
  const resetNotes = useCallback(() => {
    setCurrentIndex(0);
  }, []);

  // Handle keyboard (Space or Enter to advance)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter") nextNote();
      else if (e.code === "ArrowLeft") prevNote();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nextNote, prevNote]);

  // Reset index when song changes
  useEffect(() => {
    setCurrentIndex(0);
  }, [songKey]);

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
        </header>
      )}

      {/* --- Play Area --- */}
      <main
        style={styles.main}
        onClick={mode === "dynamic" ? nextNote : undefined}
      >
        {mode === "static" ? (
          <div style={styles.staticGrid}>
            {notes.map((note, i) => (
              <NoteCard
                key={i}
                note={note}
                isActive={i === currentIndex}
                onClick={() => setCurrentIndex(i)}
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
            />

            {/* Upcoming Notes */}
            <div style={styles.previewStrip}>
              {notes
                .slice(currentIndex + 1, currentIndex + 1 + UPCOMING_COUNT)
                .map((note, i) => (
                  <NoteCard key={i} note={note} isActive={false} />
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
}: {
  note: Note;
  isActive: boolean;
  isLarge?: boolean;
  onClick?: () => void;
}) {
  const color = (COLOR_MAP as Record<string, string>)[note.pitch] || "#555";
  const isDarkColor = color === "black" || color === "red" || color === "blue";

  return (
    <div
      onClick={onClick}
      style={{
        ...styles.note,
        backgroundColor: color,
        width: `${note.duration * (isLarge ? BASE_UNIT * 1.5 : BASE_UNIT)}px`,
        height: isLarge ? "150px" : "80px",
        border: isActive
          ? "5px solid #00d4ff"
          : "2px solid rgba(255,255,255,0.1)",
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
    right: "10px",
    zIndex: 20,
    padding: "8px 10px",
    borderRadius: "6px",
    background: "#333",
    color: "white",
    border: "none",
    cursor: "pointer",
    fontSize: "1.1rem",
  },
};
