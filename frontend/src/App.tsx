import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Card, Deck, Topic } from "./types";
import "./App.css";

type TopicFilter = "all" | string;
type ViewMode = "sequence" | "paged";

interface ProcessPayload {
  text: string;
  topicThreshold: number;
  maxTopics: number;
  maxBullets: number;
  debug: boolean;
}

class HttpRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const DEFAULT_TOPIC_THRESHOLD = 0.75;
const DEFAULT_MAX_TOPICS = 5;
const DEFAULT_MAX_BULLETS = 5;
const REQUEST_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 3;
const PROCESS_API_ENDPOINT = "http://127.0.0.1:8000/api/process";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const formatThreshold = (value: number) => Number(value.toFixed(2));
const toFiniteOrDefault = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseDeck = (data: unknown): Deck => {
  if (!isObject(data)) {
    throw new Error("deck.json 內容不是合法物件。");
  }

  const { paragraphs, topics, cards, stats } = data;

  if (!Array.isArray(paragraphs)) {
    throw new Error("deck.json 缺少 paragraphs 陣列。");
  }
  if (!Array.isArray(topics)) {
    throw new Error("deck.json 缺少 topics 陣列。");
  }
  if (!Array.isArray(cards)) {
    throw new Error("deck.json 缺少 cards 陣列。");
  }
  if (!isObject(stats)) {
    throw new Error("deck.json 缺少 stats 物件。");
  }

  const validParagraphs = paragraphs.every((paragraph) => {
    if (!isObject(paragraph)) {
      return false;
    }
    return (
      typeof paragraph.id === "string" &&
      typeof paragraph.text === "string" &&
      typeof paragraph.summary === "string" &&
      Array.isArray(paragraph.keywords) &&
      paragraph.keywords.every((keyword) => typeof keyword === "string") &&
      typeof paragraph.sourceIndex === "number"
    );
  });

  if (!validParagraphs) {
    throw new Error("deck.json 的 paragraphs 格式不符合預期。");
  }

  const validTopics = topics.every((topic) => {
    if (!isObject(topic)) {
      return false;
    }
    return (
      typeof topic.id === "string" &&
      typeof topic.title === "string" &&
      Array.isArray(topic.memberIds) &&
      topic.memberIds.every((id) => typeof id === "string")
    );
  });

  if (!validTopics) {
    throw new Error("deck.json 的 topics 格式不符合預期。");
  }

  const validCards = cards.every((card) => {
    if (!isObject(card)) {
      return false;
    }
    return (
      typeof card.id === "string" &&
      typeof card.topicId === "string" &&
      typeof card.title === "string" &&
      Array.isArray(card.bullets) &&
      card.bullets.every((bullet) => typeof bullet === "string")
    );
  });

  if (!validCards) {
    throw new Error("deck.json 的 cards 格式不符合預期。");
  }

  if (
    typeof stats.paragraphCount !== "number" ||
    typeof stats.topicCount !== "number" ||
    typeof stats.cardCount !== "number"
  ) {
    throw new Error("deck.json 的 stats 欄位格式不符合預期。");
  }

  if (stats.paragraphCount !== paragraphs.length) {
    throw new Error("deck.json 的 paragraphCount 與 paragraphs 數量不一致。");
  }
  if (stats.topicCount !== topics.length) {
    throw new Error("deck.json 的 topicCount 與 topics 數量不一致。");
  }
  if (stats.cardCount !== cards.length) {
    throw new Error("deck.json 的 cardCount 與 cards 數量不一致。");
  }

  return data as Deck;
};

const App = () => {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [isDeckLoading, setIsDeckLoading] = useState(false);
  const [deckMessage, setDeckMessage] = useState<string | null>(null);
  const [deckError, setDeckError] = useState<string | null>(null);

  const [sourceText, setSourceText] = useState("");
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  const [topicThreshold, setTopicThreshold] = useState(DEFAULT_TOPIC_THRESHOLD);
  const [maxTopics, setMaxTopics] = useState(DEFAULT_MAX_TOPICS);
  const [maxBullets, setMaxBullets] = useState(DEFAULT_MAX_BULLETS);
  const [debug, setDebug] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [processMessage, setProcessMessage] = useState<string | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [lastPayload, setLastPayload] = useState<ProcessPayload | null>(null);

  const [currentTopicId, setCurrentTopicId] = useState<TopicFilter>("all");
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("sequence");
  const [currentPage, setCurrentPage] = useState(0);

  const loadDeck = useCallback(async (): Promise<Deck> => {
    setIsDeckLoading(true);
    setDeckError(null);
    setDeckMessage(null);

    try {
      const response = await fetch("/deck.json", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`讀取 deck.json 失敗（HTTP ${response.status}）。`);
      }

      const jsonData = await response.json();
      const parsedDeck = parseDeck(jsonData);
      setDeck(parsedDeck);
      setCurrentTopicId((prevTopicId) =>
        prevTopicId === "all" ||
        parsedDeck.topics.some((topic) => topic.id === prevTopicId)
          ? prevTopicId
          : "all",
      );
      setDeckMessage("deck.json 載入成功。");
      return parsedDeck;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "讀取卡片資料時發生未知錯誤。";
      setDeck(null);
      setDeckError(message);
      throw error;
    } finally {
      setIsDeckLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDeck();
  }, [loadDeck]);

  const topics = deck?.topics ?? [];
  const cards = deck?.cards ?? [];
  const stats = deck?.stats;

  const visibleCards = useMemo<Card[]>(() => {
    if (currentTopicId === "all") {
      return cards;
    }
    return cards.filter((card) => card.topicId === currentTopicId);
  }, [cards, currentTopicId]);

  const totalCards = visibleCards.length;
  const totalPages = Math.max(1, Math.ceil(totalCards / PAGE_SIZE));

  useEffect(() => {
    setCurrentCardIndex((prevIndex) => {
      if (totalCards === 0) {
        return 0;
      }
      return Math.min(prevIndex, totalCards - 1);
    });
    setCurrentPage((prevPage) => {
      if (totalCards === 0) {
        return 0;
      }
      return Math.min(prevPage, totalPages - 1);
    });
  }, [totalCards, totalPages]);

  const currentCard = visibleCards[currentCardIndex];
  const pageStartIndex = currentPage * PAGE_SIZE;
  const pageCards = visibleCards.slice(pageStartIndex, pageStartIndex + PAGE_SIZE);
  const canPrevPage = currentPage > 0;
  const canNextPage = currentPage < totalPages - 1;
  const canPrevCard = currentCardIndex > 0;
  const canNextCard = currentCardIndex < totalCards - 1;

  const resolveTopicTitle = useCallback(() => {
    if (!deck) {
      return "全部主題";
    }

    if (currentTopicId === "all" && !currentCard) {
      return "全部主題";
    }

    const topicId =
      currentTopicId === "all" ? currentCard?.topicId : currentTopicId;
    const topic = deck.topics.find((item: Topic) => item.id === topicId);
    return topic?.title || "未命名主題";
  }, [currentCard, currentTopicId, deck]);

  const handleTopicChange = (topicId: TopicFilter) => {
    setCurrentTopicId(topicId);
    setCurrentCardIndex(0);
    setCurrentPage(0);
  };

  const handlePrev = () => {
    setCurrentCardIndex((prev) => Math.max(prev - 1, 0));
  };

  const handleNext = () => {
    setCurrentCardIndex((prev) => Math.min(prev + 1, totalCards - 1));
  };

  const isAllowedFileName = (fileName: string): boolean => {
    const lowerName = fileName.toLowerCase();
    return lowerName.endsWith(".txt") || lowerName.endsWith(".md");
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setInputError(null);
    setProcessError(null);
    setProcessMessage(null);

    if (!isAllowedFileName(file.name)) {
      setSelectedFileName(null);
      setInputError("僅支援 .txt 或 .md 檔案，請重新選擇。");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      setSourceText(content);
      setSelectedFileName(file.name);
      if (!content.trim()) {
        setInputError("檔案內容為空，請提供有效文字。");
      }
    };
    reader.onerror = () => {
      setSelectedFileName(null);
      setInputError("讀取檔案失敗，請確認檔案編碼為 UTF-8。");
    };

    reader.readAsText(file, "utf-8");
  };

  const validateAndNormalizePayload = (
    rawPayload: ProcessPayload,
  ): {
    payload: ProcessPayload;
    warnings: string[];
  } => {
    const warnings: string[] = [];

    const safeThreshold = toFiniteOrDefault(
      rawPayload.topicThreshold,
      DEFAULT_TOPIC_THRESHOLD,
    );
    const safeTopics = toFiniteOrDefault(rawPayload.maxTopics, DEFAULT_MAX_TOPICS);
    const safeBullets = toFiniteOrDefault(
      rawPayload.maxBullets,
      DEFAULT_MAX_BULLETS,
    );

    const normalizedThreshold = formatThreshold(clamp(safeThreshold, 0, 1));
    const normalizedTopics = clamp(Math.round(safeTopics), 1, 10);
    const normalizedBullets = clamp(Math.round(safeBullets), 1, 5);

    if (normalizedThreshold !== rawPayload.topicThreshold) {
      warnings.push("分群閾值超出範圍，已自動調整為 0.00–1.00。");
    }
    if (normalizedTopics !== rawPayload.maxTopics) {
      warnings.push("最大主題數超出範圍，已自動調整為 1–10。");
    }
    if (normalizedBullets !== rawPayload.maxBullets) {
      warnings.push("每卡摘要數超出範圍，已自動調整為 1–5。");
    }

    const payload: ProcessPayload = {
      text: rawPayload.text,
      topicThreshold: normalizedThreshold,
      maxTopics: normalizedTopics,
      maxBullets: normalizedBullets,
      debug: rawPayload.debug,
    };

    setTopicThreshold(normalizedThreshold);
    setMaxTopics(normalizedTopics);
    setMaxBullets(normalizedBullets);

    return { payload, warnings };
  };

  const extractApiErrorMessage = async (
    response: Response,
  ): Promise<string | null> => {
    try {
      const data: unknown = await response.json();
      if (isObject(data)) {
        if (typeof data.message === "string") {
          return data.message;
        }
        if (typeof data.detail === "string") {
          return data.detail;
        }
        if (Array.isArray(data.detail)) {
          return data.detail
            .map((item) => {
              if (isObject(item) && typeof item.msg === "string") {
                return item.msg;
              }
              return "";
            })
            .filter(Boolean)
            .join("；");
        }
      }
    } catch {
      return null;
    }

    return null;
  };

  const submitProcessRequest = useCallback(
    async (payload: ProcessPayload, fromRetry = false) => {
      const normalizedResult = validateAndNormalizePayload(payload);
      const normalizedPayload = normalizedResult.payload;
      setLastPayload(normalizedPayload);
      setCanRetry(false);
      setProcessError(null);
      setProcessMessage("後端處理中，請稍候...");
      setIsSubmitting(true);

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => {
        controller.abort();
      }, REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(PROCESS_API_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: normalizedPayload.text,
            topic_threshold: normalizedPayload.topicThreshold,
            max_topics: normalizedPayload.maxTopics,
            max_bullets: normalizedPayload.maxBullets,
            debug: normalizedPayload.debug,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const apiMessage = await extractApiErrorMessage(response);
          throw new HttpRequestError(
            response.status,
            apiMessage || `Backend 回應失敗（HTTP ${response.status}）。`,
          );
        }

        const refreshedDeck = await loadDeck();
        setCurrentCardIndex(0);
        setCurrentPage(0);

        const warningText =
          normalizedResult.warnings.length > 0
            ? `（已自動修正參數：${normalizedResult.warnings.join(" ")}）`
            : "";
        const retryText = fromRetry ? "（重試成功）" : "";
        setProcessMessage(
          `已成功產生 ${refreshedDeck.stats.cardCount} 張卡片${retryText}${warningText}`,
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setCanRetry(true);
          setProcessError("請求逾時，請確認 Backend 狀態後重試。");
          return;
        }

        if (error instanceof HttpRequestError) {
          setCanRetry(true);
          setProcessError(error.message);
          return;
        }

        if (error instanceof TypeError) {
          setCanRetry(true);
          setProcessError("無法連接到 Backend，請確認服務已啟動。");
          return;
        }

        setCanRetry(true);
        setProcessError("網路連接失敗，請檢查網路狀態。");
      } finally {
        window.clearTimeout(timeoutId);
        setIsSubmitting(false);
      }
    },
    [loadDeck],
  );

  const handleGenerate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setInputError(null);
    setProcessError(null);
    setProcessMessage(null);

    const text = sourceText.trim();
    if (!text) {
      setInputError("文字內容不可為空，請輸入內容或上傳檔案。");
      return;
    }

    const payload: ProcessPayload = {
      text,
      topicThreshold,
      maxTopics,
      maxBullets,
      debug,
    };

    await submitProcessRequest(payload);
  };

  const handleRetry = async () => {
    if (!lastPayload || isSubmitting) {
      return;
    }
    await submitProcessRequest(lastPayload, true);
  };

  const handleReloadDeck = async () => {
    setProcessError(null);
    setProcessMessage(null);
    try {
      await loadDeck();
      setDeckMessage("已重新載入最新卡片資料。");
    } catch {
      // 錯誤訊息已由 loadDeck 寫入 deckError。
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName.toUpperCase());
      if (isTypingTarget) {
        return;
      }

      if (event.key === "ArrowLeft") {
        if (viewMode === "sequence" && canPrevCard) {
          event.preventDefault();
          handlePrev();
        }
        if (viewMode === "paged" && canPrevPage) {
          event.preventDefault();
          setCurrentPage((prev) => Math.max(0, prev - 1));
        }
      }

      if (event.key === "ArrowRight") {
        if (viewMode === "sequence" && canNextCard) {
          event.preventDefault();
          handleNext();
        }
        if (viewMode === "paged" && canNextPage) {
          event.preventDefault();
          setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1));
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [canNextCard, canNextPage, canPrevCard, canPrevPage, totalPages, viewMode]);

  return (
    <div className="app">
      <div className="app-shell">
        <header className="app-header">
          <div className="app-title">文件歸納切卡機 · Frontend</div>
          <div className="app-subtitle">
            資料來源：public/deck.json｜API：POST /api/process
          </div>
        </header>

        <div className="main-layout">
          <aside className="sidebar">
            <section className="panel">
              <div className="panel-title">輸入內容與參數</div>
              <form className="process-form" onSubmit={handleGenerate}>
                <label className="field-label" htmlFor="source-file">
                  上傳檔案（僅 .txt / .md）
                </label>
                <input
                  id="source-file"
                  type="file"
                  accept=".txt,.md"
                  onChange={handleFileChange}
                  disabled={isSubmitting}
                />
                {selectedFileName ? (
                  <div className="field-helper">已載入：{selectedFileName}</div>
                ) : null}

                <label className="field-label" htmlFor="source-text">
                  文字輸入
                </label>
                <textarea
                  id="source-text"
                  className="source-textarea"
                  placeholder="請貼上文字內容或先上傳檔案..."
                  value={sourceText}
                  onChange={(event) => setSourceText(event.target.value)}
                  rows={8}
                  disabled={isSubmitting}
                />

                <div className="field-group">
                  <label className="field-label" htmlFor="topic-threshold">
                    分群閾值：{topicThreshold.toFixed(2)}
                  </label>
                  <input
                    id="topic-threshold"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={topicThreshold}
                    onChange={(event) =>
                      setTopicThreshold(
                        formatThreshold(Number(event.target.value)),
                      )
                    }
                    disabled={isSubmitting}
                  />
                  <div className="field-helper">相似度閾值，數值越高分群越細</div>
                </div>

                <div className="field-grid">
                  <label className="field-group">
                    <span className="field-label">最大主題數（1-10）</span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={maxTopics}
                      onChange={(event) =>
                        setMaxTopics(
                          toFiniteOrDefault(
                            event.currentTarget.valueAsNumber,
                            DEFAULT_MAX_TOPICS,
                          ),
                        )
                      }
                      disabled={isSubmitting}
                    />
                  </label>

                  <label className="field-group">
                    <span className="field-label">每卡摘要數（1-5）</span>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={maxBullets}
                      onChange={(event) =>
                        setMaxBullets(
                          toFiniteOrDefault(
                            event.currentTarget.valueAsNumber,
                            DEFAULT_MAX_BULLETS,
                          ),
                        )
                      }
                      disabled={isSubmitting}
                    />
                  </label>
                </div>

                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={debug}
                    onChange={(event) => setDebug(event.target.checked)}
                    disabled={isSubmitting}
                  />
                  <span>除錯模式（顯示詳細處理資訊）</span>
                </label>

                {inputError ? <div className="error-text">{inputError}</div> : null}
                {processError ? (
                  <div className="error-text">{processError}</div>
                ) : null}
                {processMessage ? (
                  <div className="success-text">{processMessage}</div>
                ) : null}
                {deckMessage ? <div className="success-text">{deckMessage}</div> : null}
                {deckError ? <div className="error-text">{deckError}</div> : null}

                <div className="action-row">
                  <button
                    className="nav-button"
                    type="submit"
                    disabled={isSubmitting || isDeckLoading}
                  >
                    {isSubmitting ? "生成中..." : "生成卡片"}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={handleReloadDeck}
                    disabled={isSubmitting || isDeckLoading}
                  >
                    重新載入 deck.json
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={handleRetry}
                    disabled={!canRetry || isSubmitting}
                  >
                    重試上次請求
                  </button>
                </div>
              </form>
            </section>

            <section className="panel panel-static">
              <div className="panel-title">統計資訊</div>
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-label">段落數</div>
                  <div className="stat-value">
                    {stats?.paragraphCount ?? 0}
                  </div>
                </div>
                <div className="stat-item">
                  <div className="stat-label">主題數</div>
                  <div className="stat-value">{stats?.topicCount ?? 0}</div>
                </div>
                <div className="stat-item">
                  <div className="stat-label">卡片數</div>
                  <div className="stat-value">{stats?.cardCount ?? 0}</div>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-title">主題列表</div>
              <div className="topics-list">
                <button
                  className={`topic-button ${
                    currentTopicId === "all" ? "active" : ""
                  }`}
                  onClick={() => handleTopicChange("all")}
                >
                  全部主題
                </button>
                {topics.map((topic: Topic) => (
                  <button
                    key={topic.id}
                    className={`topic-button ${
                      currentTopicId === topic.id ? "active" : ""
                    }`}
                    onClick={() => handleTopicChange(topic.id)}
                  >
                    {topic.title || "未命名主題"}
                  </button>
                ))}
              </div>
            </section>
          </aside>

          <main className="main-panel">
            {isDeckLoading ? (
              <div className="empty-state">資料載入中...</div>
            ) : totalCards === 0 ? (
              <div className="empty-state">
                目前沒有卡片可顯示（可能是資料尚未產生）。
              </div>
            ) : (
              <div className="card-viewer">
                <div className="card-meta">
                  <div className="card-topic">
                    <span className="card-topic-text">{resolveTopicTitle()}</span>
                    <span className="card-counter">
                      {viewMode === "sequence"
                        ? `第 ${currentCardIndex + 1} 張 / 共 ${totalCards} 張`
                        : `第 ${currentPage + 1} 頁 / 共 ${totalPages} 頁`}
                    </span>
                  </div>
                </div>

                <div className="view-mode-row">
                  <button
                    className={`secondary-button ${
                      viewMode === "sequence" ? "active-mode" : ""
                    }`}
                    onClick={() => setViewMode("sequence")}
                    type="button"
                  >
                    序列翻卡
                  </button>
                  <button
                    className={`secondary-button ${
                      viewMode === "paged" ? "active-mode" : ""
                    }`}
                    onClick={() => setViewMode("paged")}
                    type="button"
                  >
                    分頁瀏覽
                  </button>
                  <span className="field-helper">支援鍵盤左右鍵操作</span>
                </div>

                {viewMode === "sequence" ? (
                  <>
                    <div className="card">
                      <h2 className="card-title">
                        {currentCard?.title || "未命名卡片"}
                      </h2>
                      {currentCard?.bullets?.length ? (
                        <ul className="card-bullets">
                          {currentCard.bullets.map((bullet: string, idx: number) => (
                            <li key={idx}>{bullet}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="card-empty">（此卡片目前沒有內容）</p>
                      )}
                    </div>

                    <div className="controls">
                      <button
                        className="nav-button"
                        onClick={handlePrev}
                        disabled={!canPrevCard}
                      >
                        ← 上一張
                      </button>
                      <button
                        className="nav-button"
                        onClick={handleNext}
                        disabled={!canNextCard}
                      >
                        下一張 →
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="card-list">
                      {pageCards.map((card) => (
                        <article className="card" key={card.id}>
                          <h2 className="card-title">{card.title || "未命名卡片"}</h2>
                          {card.bullets.length > 0 ? (
                            <ul className="card-bullets">
                              {card.bullets.map((bullet, idx) => (
                                <li key={`${card.id}-${idx}`}>{bullet}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="card-empty">（此卡片目前沒有內容）</p>
                          )}
                        </article>
                      ))}
                    </div>
                    <div className="controls">
                      <button
                        className="nav-button"
                        onClick={() => setCurrentPage((prev) => Math.max(0, prev - 1))}
                        disabled={!canPrevPage}
                      >
                        ← 上一頁
                      </button>
                      <button
                        className="nav-button"
                        onClick={() =>
                          setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1))
                        }
                        disabled={!canNextPage}
                      >
                        下一頁 →
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};

export default App;


