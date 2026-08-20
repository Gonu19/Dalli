/**
 * 메트로놈 트랙 생성 — 박자를 미리 오디오로 굽는다.
 *
 * ## 왜 이렇게 하나 ⚠️
 *
 * 박을 JS 타이머로 하나씩 울리면 박자가 흔들린다. `setTimeout`은 JS 스레드가 밀린
 * 만큼 늦게 오고, 그 편차가 그대로 박자 흔들림으로 들린다. **음악이 함께 나오면
 * 스레드가 더 밀려 고른 박자가 아예 나오지 않는다.**
 *
 * 그래서 필요한 길이만큼의 클릭을 한 파일로 만들어 **한 번만 재생한다.** 박 사이 간격은
 * 샘플 단위로 확정되므로 재생이 늦게 시작되더라도 간격은 흔들리지 않는다. 타이밍을
 * 네이티브 오디오 엔진이 맡고 JS는 관여하지 않는다.
 *
 * 클릭음은 종전 인라인 WAV와 같은 소리다 (22050Hz, 1400Hz 사인파, 35ms 감쇠).
 */

const SAMPLE_RATE = 22050;
/** 클릭 기본 주파수(Hz). */
const CLICK_HZ = 1400;
/** 감쇠 시정수(초). 35ms 동안 진폭이 약 1/10로 떨어진다. */
const CLICK_DECAY_SEC = 0.0148;
const CLICK_SEC = 0.035;
/** 16비트 최대치(32767)에 여유를 둔 피크. 음악 위에 얹혀도 깨지지 않는다. */
const CLICK_PEAK = 27538;

/** 같은 박자를 다시 만들지 않는다. 미리듣기에서 리듬을 오갈 때 반복 생성이 잦다. */
const cache = new Map<string, string>();
/** 캐시 상한. 5초 트랙 하나가 약 290KB라 넉넉히 잡지 않는다. */
const CACHE_LIMIT = 3;

/**
 * `bpm` 박자로 `durationSec` 길이의 WAV 데이터 URI를 만든다.
 * 첫 클릭은 0초에 놓여 재생 즉시 첫 박이 들린다.
 */
export function buildMetronomeTrack(bpm: number, durationSec: number): string {
  const key = `${Math.round(bpm)}|${durationSec}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const uri = renderTrack(bpm, durationSec);
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, uri);
  return uri;
}

function renderTrack(bpm: number, durationSec: number): string {
  const total = Math.max(1, Math.round(durationSec * SAMPLE_RATE));
  const intervalSamples = (SAMPLE_RATE * 60) / bpm;
  const clickSamples = Math.min(total, Math.round(CLICK_SEC * SAMPLE_RATE));
  const samples = new Int16Array(total);

  for (let beat = 0; ; beat += 1) {
    const start = Math.round(beat * intervalSamples);
    if (start >= total) break;
    for (let i = 0; i < clickSamples && start + i < total; i += 1) {
      const t = i / SAMPLE_RATE;
      samples[start + i] = Math.round(
        CLICK_PEAK * Math.sin(2 * Math.PI * CLICK_HZ * t) * Math.exp(-t / CLICK_DECAY_SEC),
      );
    }
  }
  return `data:audio/wav;base64,${toBase64(toWav(samples))}`;
}

/** 16비트 모노 PCM을 WAV로 감싼다. */
function toWav(samples: Int16Array): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new Uint8Array(44 + dataBytes);
  const view = new DataView(buffer.buffer);

  writeAscii(buffer, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(buffer, 8, 'WAVEfmt ');
  view.setUint32(16, 16, true); // fmt 청크 길이
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 모노
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // 초당 바이트
  view.setUint16(32, 2, true); // 블록 정렬
  view.setUint16(34, 16, true); // 비트 심도
  writeAscii(buffer, 36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i += 1) view.setInt16(44 + i * 2, samples[i], true);
  return buffer;
}

function writeAscii(target: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) target[offset + i] = text.charCodeAt(i);
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** RN에는 `Buffer`도 `atob`도 없다. 바이트 배열을 직접 옮긴다. */
function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    chunk += BASE64_ALPHABET[a >> 2];
    chunk += BASE64_ALPHABET[((a & 3) << 4) | (b >> 4)];
    chunk += i + 1 < bytes.length ? BASE64_ALPHABET[((b & 15) << 2) | (c >> 6)] : '=';
    chunk += i + 2 < bytes.length ? BASE64_ALPHABET[c & 63] : '=';
    // 긴 문자열을 한 번에 이어 붙이면 느리다. 조각으로 모았다가 마지막에 합친다.
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = '';
    }
  }
  parts.push(chunk);
  return parts.join('');
}
