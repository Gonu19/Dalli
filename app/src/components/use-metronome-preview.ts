import { useCallback, useEffect, useRef, useState } from 'react';

import { previewMetronome, stopPreview } from '@/src/native/cue-player';

/**
 * 목표 리듬 미리듣기. 러닝 준비와 온보딩의 리듬 조절이 같은 동작을 쓴다.
 *
 * 숫자만 보고는 160 spm이 어떤 빠르기인지 알 수 없다. 귀로 확인하게 한다.
 * 재생 길이·클릭음·오디오 덕킹은 러닝 중 개입 메트로놈과 같다 — 여기서 들은 박자가
 * 러닝 중에 그대로 나와야 한다.
 *
 * `bpm`이 바뀌면 바뀐 박자로 **다시 들려준다.** 화면 숫자와 들리는 박자가 어긋나면 안 된다.
 */
export function useMetronomePreview(bpm: number | null) {
  const [previewing, setPreviewing] = useState(false);
  /** 앞선 재생의 완료 콜백이 새 재생의 상태를 덮지 않게 하는 표. */
  const session = useRef(0);
  /** 재생 여부를 effect에서 읽는다. 상태를 의존성에 넣으면 재생이 자기 자신을 다시 부른다. */
  const running = useRef(false);

  const start = useCallback((value: number) => {
    const current = session.current + 1;
    session.current = current;
    stopPreview();
    running.current = true;
    setPreviewing(true);
    void previewMetronome(value).finally(() => {
      if (session.current !== current) return;
      running.current = false;
      setPreviewing(false);
    });
  }, []);

  const stop = useCallback(() => {
    session.current += 1;
    running.current = false;
    stopPreview();
    setPreviewing(false);
  }, []);

  useEffect(() => {
    if (!running.current || bpm === null) return;
    start(bpm);
  }, [bpm, start]);

  // 화면을 떠날 때 소리가 남지 않게 한다.
  useEffect(() => stop, [stop]);

  const toggle = useCallback(() => {
    if (running.current) stop();
    else if (bpm !== null) start(bpm);
  }, [bpm, start, stop]);

  return { previewing, toggle, stop };
}
