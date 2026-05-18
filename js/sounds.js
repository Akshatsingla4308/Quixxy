const CORRECT_SRC = "./assets/correct.mp3";
const WRONG_SRC = "./assets/wrong.mp3";

function readSoundPreference() {
  try {
    const raw = window.localStorage.getItem("quixxy-live-sound");
    if (raw === null) {
      return true;
    }
    return raw !== "0";
  } catch {
    return true;
  }
}

export function setLiveSoundEnabled(enabled) {
  try {
    window.localStorage.setItem("quixxy-live-sound", enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function isLiveSoundEnabled() {
  return readSoundPreference();
}

function playOscillatorTone(isCorrect) {
  if (!window.AudioContext && !window.webkitAudioContext) {
    return;
  }

  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  const audio = new AudioCtor();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.type = "sine";
  oscillator.frequency.value = isCorrect ? 920 : 220;
  gain.gain.value = 0.035;
  oscillator.start();
  oscillator.stop(audio.currentTime + 0.18);
}

export function playLiveFeedback(isCorrect) {
  if (!readSoundPreference()) {
    return;
  }

  const src = isCorrect ? CORRECT_SRC : WRONG_SRC;
  const audio = new Audio(src);
  audio.volume = 0.42;
  audio.play().catch(() => {
    playOscillatorTone(isCorrect);
  });
}
