/**
 * 업로드 큐의 규칙 (`ROADMAP.md` `F1-10`).
 *
 * 저장 매체를 모른다 — 파일이든 메모리든 어댑터만 갈아끼운다.
 * 덕분에 큐의 규칙(순서·재시도·중복)을 실기기 없이 Node에서 검증할 수 있다.
 */

import type { RunRecord } from './runStore';

export type QueuedRun = {
  record: RunRecord;
  /** 업로드 시도 횟수 — 화면에서 "여러 번 실패" 안내를 띄우는 용도. */
  attempts: number;
  /** 마지막 실패 사유. 성공하면 항목이 사라지므로 남지 않는다. */
  lastError: string | null;
  savedAt: string;
};

export type QueueStorage = {
  list(): QueuedRun[];
  write(entry: QueuedRun): void;
  remove(clientRunId: string): void;
};

export type FlushResult = { uploaded: number; failed: number };

export function createQueue(storage: QueueStorage, now: () => string = () => new Date().toISOString()) {
  /**
   * 읽기 캐시.
   *
   * 저장소 읽기는 싸지 않다 — 파일 어댑터는 디렉터리를 훑고 항목마다 JSON을 파싱한다.
   * 20분 러닝 하나가 수십 KB고, `hasPending()`은 화면이 렌더될 때마다 불린다
   * (`RunUploadSync`의 `useSyncExternalStore`). 그대로 두면 러닝 중 매 초 파싱이 돈다.
   *
   * 쓰기는 전부 이 모듈을 거치므로 여기서 무효화하면 캐시가 어긋나지 않는다.
   */
  let cache: QueuedRun[] | null = null;

  function entries(): QueuedRun[] {
    cache ??= storage.list();
    return cache;
  }

  function invalidate(): void {
    cache = null;
  }

  /** 오래된 것부터. 순서대로 올려야 캘린더·통계가 뒤엉키지 않는다. */
  function list(): QueuedRun[] {
    return [...entries()].sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  }

  return {
    list,

    /** 저장소를 다시 읽는다. 외부에서 파일을 건드렸을 때만 필요하다. */
    refresh: invalidate,

    /**
     * 종료 직후 호출. **업로드보다 먼저 부른다.**
     * 같은 `clientRunId`를 다시 넣으면 덮어쓴다 — 러닝 하나에 항목 하나다.
     */
    enqueue(record: RunRecord): QueuedRun {
      const entry: QueuedRun = { record, attempts: 0, lastError: null, savedAt: now() };
      storage.write(entry);
      invalidate();
      return entry;
    },

    /** 업로드가 확인된 뒤에만 지운다. */
    dequeue(clientRunId: string): void {
      storage.remove(clientRunId);
      invalidate();
    },

    /** 실패 기록. 큐에서 빼지 않는다 — 다음 기회에 다시 시도한다. */
    markFailed(clientRunId: string, error: unknown): QueuedRun | null {
      const entry = entries().find((item) => item.record.clientRunId === clientRunId);
      if (entry === undefined) return null;

      const updated: QueuedRun = {
        ...entry,
        attempts: entry.attempts + 1,
        lastError: error instanceof Error ? error.message : String(error),
      };
      storage.write(updated);
      invalidate();
      return updated;
    },

    /** 렌더마다 불릴 수 있다 — 캐시된 목록만 본다. */
    hasPending(): boolean {
      return entries().length > 0;
    },

    /**
     * 큐를 순서대로 비운다.
     *
     * 서버가 `(user_id, client_run_id)` 멱등이므로 **이미 올라간 러닝을 다시 보내도 안전하다**
     * (`CONTRACT.md`). 그래서 성공을 확인한 뒤에만 지우고, 애매하면 다시 보내는 쪽을 택한다.
     */
    async flush(upload: (record: RunRecord) => Promise<unknown>): Promise<FlushResult> {
      let uploaded = 0;
      let failed = 0;

      for (const entry of list()) {
        try {
          await upload(entry.record);
          storage.remove(entry.record.clientRunId);
          invalidate();
          uploaded += 1;
        } catch (error) {
          this.markFailed(entry.record.clientRunId, error);
          invalidate();
          failed += 1;
          // 첫 실패에서 멈춘다. 대개 네트워크가 끊긴 상황이라 나머지도 실패하고,
          // 순서를 지키려면 여기서 끊는 편이 낫다.
          break;
        }
      }

      return { uploaded, failed };
    },
  };
}

export type RunQueue = ReturnType<typeof createQueue>;
