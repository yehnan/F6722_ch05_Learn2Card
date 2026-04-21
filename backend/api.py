from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

MAX_INPUT_CHARS = 20_000
VECTOR_SIZE = 64
SUMMARY_LIMIT = 60

HEADING_PATTERN = re.compile(r"^\s{0,3}#{1,6}\s+.+$")
LIST_PATTERN = re.compile(r"^\s*(?:[-*+]|\d+\.)\s+.+$")
SENTENCE_SPLIT_PATTERN = re.compile(r"[。！？!?；;]")
TOKEN_PATTERN = re.compile(r"[\u4e00-\u9fff]{2,}|[A-Za-z][A-Za-z0-9_-]{2,}")
URL_PATTERN = re.compile(r"^\s*https?://", re.IGNORECASE)
PATH_PATTERN = re.compile(
    r"^\s*(?:[A-Za-z]:\\|\.{1,2}[\\/]|[^\n]+\.(?:txt|md|markdown))\s*$",
    re.IGNORECASE,
)

STOPWORDS = {
    "and",
    "are",
    "for",
    "from",
    "that",
    "the",
    "this",
    "with",
    "you",
    "your",
    "以及",
    "但",
    "如果",
    "我們",
    "或",
    "是",
    "的",
    "與",
    "要",
    "讓",
    "請",
    "需要",
}


class Paragraph(BaseModel):
    id: str
    text: str
    summary: str
    keywords: list[str]
    sourceIndex: int


class Topic(BaseModel):
    id: str
    title: str
    memberIds: list[str]


class Card(BaseModel):
    id: str
    topicId: str
    title: str
    bullets: list[str]


class DeckStats(BaseModel):
    paragraphCount: int
    topicCount: int
    cardCount: int


class Deck(BaseModel):
    paragraphs: list[Paragraph]
    topics: list[Topic]
    cards: list[Card]
    stats: DeckStats


class ProcessRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    topic_threshold: float = Field(default=0.75, ge=0.0, le=1.0)
    max_topics: int = Field(default=5, ge=1)
    max_bullets: int = Field(default=5, ge=1, le=5)
    debug: bool = False


class DebugData(BaseModel):
    normalizedParagraphs: list[str]
    topicGroups: list[list[str]]
    similarityMatrix: list[list[float]]


class ProcessResponse(BaseModel):
    success: bool
    message: str
    outputPath: str
    stats: DeckStats
    deck: Deck
    debug: DebugData | None = None


app = FastAPI(title="Agent A Backend API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(_: Any, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={"detail": "參數驗證失敗", "errors": exc.errors()},
    )


def _normalize_text(text: str) -> str:
    if not isinstance(text, str):
        raise ValueError("輸入格式錯誤：text 欄位必須是純文字字串。")

    if not text.strip():
        raise ValueError("輸入為空：請提供非空的純文字字串。")

    if URL_PATTERN.match(text):
        raise ValueError("輸入格式錯誤：text 欄位僅接受純文字，不接受 URL。")

    if "\n" not in text and PATH_PATTERN.match(text):
        raise ValueError("輸入格式錯誤：text 欄位僅接受純文字，不接受檔案路徑。")

    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if len(normalized) > MAX_INPUT_CHARS:
        raise ValueError(
            f"輸入過長：目前上限為 {MAX_INPUT_CHARS} 字元，實際為 {len(normalized)}。"
        )
    return normalized


def _split_paragraphs(text: str) -> list[str]:
    lines = text.split("\n")
    paragraphs: list[str] = []
    buffer: list[str] = []

    def flush_buffer() -> None:
        if not buffer:
            return
        chunk = " ".join(part.strip() for part in buffer if part.strip()).strip()
        buffer.clear()
        if chunk:
            paragraphs.append(chunk)

    for line in lines:
        stripped = line.strip()
        if not stripped:
            flush_buffer()
            continue

        if HEADING_PATTERN.match(line) or LIST_PATTERN.match(line):
            flush_buffer()
            paragraphs.append(stripped)
            continue

        buffer.append(stripped)

    flush_buffer()

    if not paragraphs:
        raise ValueError("無法切分出任何段落：請確認輸入文字內容。")
    return paragraphs


def _build_summary(text: str) -> str:
    fragments = [frag.strip() for frag in SENTENCE_SPLIT_PATTERN.split(text) if frag.strip()]
    candidate = fragments[0] if fragments else text.strip()
    if len(candidate) <= SUMMARY_LIMIT:
        return candidate
    return f"{candidate[: SUMMARY_LIMIT - 1]}…"


def _tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    for match in TOKEN_PATTERN.finditer(text):
        token = match.group(0)
        normalized = token.lower() if token.encode("utf-8").isascii() else token
        if normalized in STOPWORDS:
            continue
        tokens.append(normalized)
    return tokens


def _extract_keywords(text: str) -> list[str]:
    tokens = _tokenize(text)
    if not tokens:
        fallback = _build_summary(text)
        return [fallback[:12]] if fallback else ["重點"]

    counts = Counter(tokens)
    first_index: dict[str, int] = {}
    for idx, token in enumerate(tokens):
        first_index.setdefault(token, idx)

    ranked = sorted(tokens, key=lambda item: (-counts[item], first_index[item], item))
    unique_ranked: list[str] = []
    for token in ranked:
        if token in unique_ranked:
            continue
        unique_ranked.append(token)
        if len(unique_ranked) >= 5:
            break

    return unique_ranked or ["重點"]


def _embed(text: str) -> list[float]:
    vector = [0.0] * VECTOR_SIZE
    tokens = _tokenize(text) or [text]
    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        for i, byte in enumerate(digest):
            index = (byte + i * 11) % VECTOR_SIZE
            sign = 1.0 if byte % 2 == 0 else -1.0
            vector[index] += sign * (0.2 + byte / 255.0)

    norm = math.sqrt(sum(component * component for component in vector))
    if norm == 0:
        return [0.0] * VECTOR_SIZE
    return [component / norm for component in vector]


def _cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    return sum(left * right for left, right in zip(vec_a, vec_b))


def _average_vector(vectors: list[list[float]]) -> list[float]:
    if not vectors:
        return [0.0] * VECTOR_SIZE
    totals = [0.0] * VECTOR_SIZE
    for vector in vectors:
        for idx, value in enumerate(vector):
            totals[idx] += value
    count = float(len(vectors))
    averaged = [value / count for value in totals]
    norm = math.sqrt(sum(component * component for component in averaged))
    if norm == 0:
        return averaged
    return [component / norm for component in averaged]


def _build_topic_title(member_paragraphs: list[Paragraph]) -> str:
    keyword_pool: list[str] = []
    for paragraph in member_paragraphs:
        keyword_pool.extend(paragraph.keywords)

    if keyword_pool:
        counts = Counter(keyword_pool)
        first_index: dict[str, int] = {}
        for idx, keyword in enumerate(keyword_pool):
            first_index.setdefault(keyword, idx)
        ranked = sorted(keyword_pool, key=lambda item: (-counts[item], first_index[item], item))
        title = ranked[0]
    else:
        title = member_paragraphs[0].summary if member_paragraphs else "未分類主題"

    return title[:30]


def _split_topic_members(member_ids: list[str]) -> list[list[str]]:
    if len(member_ids) <= 8:
        return [member_ids]
    midpoint = (len(member_ids) + 1) // 2
    return [member_ids[:midpoint], member_ids[midpoint:]]


def _build_cards(topics: list[Topic], paragraph_lookup: dict[str, Paragraph], max_bullets: int) -> list[Card]:
    cards: list[Card] = []
    card_counter = 1

    for topic in topics:
        member_groups = _split_topic_members(topic.memberIds)
        for group_idx, member_group in enumerate(member_groups):
            members = [paragraph_lookup[item] for item in member_group]
            bullets: list[str] = []
            for member in members:
                if member.summary not in bullets:
                    bullets.append(member.summary)
                if len(bullets) >= max_bullets:
                    break

            if len(bullets) < min(3, max_bullets):
                keyword_line = "關鍵詞：" + ", ".join(
                    list(dict.fromkeys(keyword for member in members for keyword in member.keywords))[:5]
                )
                if keyword_line not in bullets:
                    bullets.append(keyword_line)

            if not bullets:
                bullets = [topic.title]

            title_suffix = ""
            if len(member_groups) == 2:
                title_suffix = "（上）" if group_idx == 0 else "（下）"

            cards.append(
                Card(
                    id=f"c{card_counter}",
                    topicId=topic.id,
                    title=f"{topic.title}{title_suffix}",
                    bullets=bullets[:max_bullets],
                )
            )
            card_counter += 1

    return cards


def build_deck(
    text: str, topic_threshold: float, max_topics: int, max_bullets: int, debug: bool
) -> tuple[Deck, DebugData | None]:
    normalized_text = _normalize_text(text)
    raw_paragraphs = _split_paragraphs(normalized_text)

    paragraphs: list[Paragraph] = []
    vectors: list[list[float]] = []
    for idx, paragraph_text in enumerate(raw_paragraphs):
        summary = _build_summary(paragraph_text)
        keywords = _extract_keywords(paragraph_text)
        paragraph = Paragraph(
            id=f"p{idx + 1}",
            text=paragraph_text,
            summary=summary,
            keywords=keywords[:5],
            sourceIndex=idx,
        )
        paragraphs.append(paragraph)
        vectors.append(_embed(f"{summary} {' '.join(keywords)}"))

    topic_vectors: list[list[list[float]]] = []
    topic_member_indexes: list[list[int]] = []
    similarity_matrix: list[list[float]] = []

    for paragraph_idx, vector in enumerate(vectors):
        if not topic_vectors:
            topic_vectors.append([vector])
            topic_member_indexes.append([paragraph_idx])
            similarity_matrix.append([1.0])
            continue

        centroids = [_average_vector(group_vectors) for group_vectors in topic_vectors]
        similarities = [_cosine_similarity(vector, centroid) for centroid in centroids]
        similarity_matrix.append([round(score, 6) for score in similarities])

        best_topic_index = max(range(len(similarities)), key=lambda i: similarities[i])
        best_score = similarities[best_topic_index]

        if best_score >= topic_threshold:
            topic_vectors[best_topic_index].append(vector)
            topic_member_indexes[best_topic_index].append(paragraph_idx)
        elif len(topic_vectors) < max_topics:
            topic_vectors.append([vector])
            topic_member_indexes.append([paragraph_idx])
        else:
            topic_vectors[best_topic_index].append(vector)
            topic_member_indexes[best_topic_index].append(paragraph_idx)

    sorted_groups = sorted(topic_member_indexes, key=lambda members: min(paragraphs[idx].sourceIndex for idx in members))

    topics: list[Topic] = []
    paragraph_lookup = {paragraph.id: paragraph for paragraph in paragraphs}
    debug_topic_groups: list[list[str]] = []
    for topic_index, group_indexes in enumerate(sorted_groups):
        member_paragraphs = [paragraphs[group_idx] for group_idx in sorted(group_indexes)]
        member_ids = [item.id for item in member_paragraphs]
        debug_topic_groups.append(member_ids)
        topics.append(
            Topic(
                id=f"t{topic_index + 1}",
                title=_build_topic_title(member_paragraphs),
                memberIds=member_ids,
            )
        )

    if not topics:
        fallback = Topic(id="t1", title="未分類主題", memberIds=[paragraphs[0].id])
        topics.append(fallback)

    cards = _build_cards(topics=topics, paragraph_lookup=paragraph_lookup, max_bullets=max_bullets)

    deck = Deck(
        paragraphs=paragraphs,
        topics=topics,
        cards=cards,
        stats=DeckStats(
            paragraphCount=len(paragraphs),
            topicCount=len(topics),
            cardCount=len(cards),
        ),
    )

    debug_payload: DebugData | None = None
    if debug:
        debug_payload = DebugData(
            normalizedParagraphs=raw_paragraphs,
            topicGroups=debug_topic_groups,
            similarityMatrix=similarity_matrix,
        )

    return deck, debug_payload


def write_deck(deck: Deck) -> Path:
    root = Path(__file__).resolve().parents[1]
    output_dir = root / "frontend" / "public"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "deck.json"

    with output_path.open("w", encoding="utf-8", newline="\n") as output_file:
        json.dump(
            deck.model_dump(mode="json"),
            output_file,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        output_file.write("\n")
    return output_path


@app.post("/api/process", response_model=ProcessResponse)
async def process(request: ProcessRequest) -> ProcessResponse:
    try:
        deck, debug_payload = build_deck(
            text=request.text,
            topic_threshold=request.topic_threshold,
            max_topics=request.max_topics,
            max_bullets=request.max_bullets,
            debug=request.debug,
        )
        output_path = write_deck(deck)
        return ProcessResponse(
            success=True,
            message="處理完成，已更新 deck.json",
            outputPath=str(output_path),
            stats=deck.stats,
            deck=deck,
            debug=debug_payload,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - 保留給執行期防護
        raise HTTPException(status_code=500, detail=f"內部錯誤：{exc}") from exc
