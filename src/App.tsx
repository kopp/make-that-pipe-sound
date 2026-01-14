import React, { useState, useEffect, useCallback } from 'react';

// --- Types ---
type Note = {
  pitch: string;
  duration: number;
};

type ColorMap = Record<string, string>;

interface SongData {
  [songName: string]: Note[];
}

// --- Mock Data (Usually loaded from JSON files) ---
const COLOR_MAP: ColorMap = {
  "C4": "yellow", "D4": "green", "E4": "blue", 
  "F4": "white", "G4": "red", "A4": "black"
};

const SONG_DATA: SongData = {
  "Twinkle": [
    { pitch: "C4", duration: 1 }, { pitch: "C4", duration: 1 },
    { pitch: "G4", duration: 1 }, { pitch: "G4", duration: 1 },
    { pitch: "A4", duration: 1 }, { pitch: "A4", duration: 1 },
    { pitch: "G4", duration: 2 },
  ]
};

const UNIT_WIDTH = 60; // Base width for 1 unit of duration
const UPCOMING_COUNT = 4; // Parameter for dynamic mode

export default function MusicApp() {
  const [mode, setMode] = useState<'static' | 'dynamic'>('static');
  const [currentIndex, setCurrentIndex] = useState(0);
  const notes = SONG_DATA["Twinkle"];

  // Advance to next note
  const nextNote = useCallback(() => {
    setCurrentIndex((prev) => (prev < notes.length - 1 ? prev + 1 : 0));
  }, [notes.length]);

  // Handle Keyboard events
  useEffect(() => {
    const handleKeyDown = () => nextNote();
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextNote]);

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', background: '#333', minHeight: '100vh', color: 'white' }}>
      <h1>Music Color Player</h1>
      
      <div style={{ marginBottom: '20px' }}>
        <button onClick={() => setMode('static')}>Static Mode</button>
        <button onClick={() => setMode('dynamic')}>Dynamic Mode</button>
        <button onClick={() => setCurrentIndex(0)}>Reset</button>
      </div>

      {mode === 'static' ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          {notes.map((note, i) => (
            <NoteRectangle 
              key={i} 
              note={note} 
              isActive={i === currentIndex} 
              onClick={() => setCurrentIndex(i)} 
            />
          ))}
        </div>
      ) : (
        <div 
          onClick={nextNote}
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '20px', 
            padding: '40px', 
            background: '#222', 
            cursor: 'pointer',
            overflow: 'hidden'
          }}
        >
          {/* Current Note - Displayed Larger */}
          <NoteRectangle 
            note={notes[currentIndex]} 
            isActive={true} 
            isLarge={true} 
          />
          
          {/* Upcoming Notes */}
          {notes.slice(currentIndex + 1, currentIndex + 1 + UPCOMING_COUNT).map((note, i) => (
            <NoteRectangle key={i} note={note} isActive={false} />
          ))}
        </div>
      )}
      
      <p>Tip: Press any key or click in Dynamic Mode to play the next note.</p>
    </div>
  );
}

// --- Sub-component for the Note Rectangle ---
function NoteRectangle({ 
  note, 
  isActive, 
  isLarge = false, 
  onClick 
}: { 
  note: Note; 
  isActive: boolean; 
  isLarge?: boolean;
  onClick?: () => void;
}) {
  const color = COLOR_MAP[note.pitch] || 'grey';
  
  return (
    <div
      onClick={onClick}
      style={{
        width: `${note.duration * (isLarge ? UNIT_WIDTH * 1.5 : UNIT_WIDTH)}px`,
        height: isLarge ? '100px' : '60px',
        backgroundColor: color,
        border: isActive ? '4px solid orange' : '2px solid transparent',
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.2s ease',
        color: color === 'white' || color === 'yellow' ? 'black' : 'white',
        fontWeight: 'bold',
        fontSize: isLarge ? '1.2rem' : '0.8rem',
        flexShrink: 0
      }}
    >
      {note.pitch}
    </div>
  );
}