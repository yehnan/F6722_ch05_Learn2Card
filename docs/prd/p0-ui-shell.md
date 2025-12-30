# P0：文件歸納切卡機 · UI Shell 需求說明

## 背景與目標

這個專案最終目標是做一個「文件歸納切卡機」，把一份 Markdown/純文字文件整理成一疊「簡報式卡片」，會再透過 Cloud Agent 實作解析、分群與 JSON 輸出邏輯。

但目前這個階段（P0），**只需要一個可以跑、可以 demo 的「前端 UI 外殼」**，用內建的假資料（sample deck）來展示畫面長相與基本互動，不需要串接任何後端或 LLM。

之後會有 A-agent 負責產生 `deck.json`，B-agent 會把 UI 改成讀取真正的 `deck.json`，但那是後面的事。  
**P0 的目標只有：把 UI shell 搭好，且用內建 sample 資料就能翻卡。**

---

## 技術堆疊與檔案結構（建議）

- 前端框架：React + TypeScript（可使用 Vite 或 Create React App，擇一即可）。
- 單頁應用（SPA），不需要路由。
- 主要進入點：`src/App.tsx`。
- 樣式：可以用簡單的 CSS（例如 `src/App.css`），不需要太花俏，能清楚區分版面即可。

---

## 畫面布局需求（UI 大致長相）

整體為左右分欄：

1. **上方標題列（Header）**
   - 左側文字：`文件歸納切卡機 · Demo UI Shell`
   - 右側小字（副標）：`資料來源：內建 sampleDeck（P0 假資料）`

2. **左側 Sidebar**
   - 區塊一：統計資訊
     - 顯示三個數字：
       - 段落數（paragraphCount）
       - 主題數（topicCount）
       - 卡片數（cardCount）
   - 區塊二：主題列表（Topics List）
     - 一個固定的按鈕：「全部主題」
     - 每個 topic 一顆按鈕，按下去會切換右側顯示的卡片範圍
     - 選中的按鈕要有明顯「active」狀態（例如背景色不同）

3. **右側主內容區（Main Panel）**
   - 卡片檢視區（Card Viewer）
     - 上方顯示：
       - `主題：{目前卡片所屬主題標題}`，若沒有標題顯示 `未命名主題`
       - `第 X 張 / 共 Y 張`
     - 中間是一張卡片：
       - 卡片標題（card.title），若沒有則顯示 `未命名卡片`
       - 下一行開始是 bullets（1–5 條），用 `<ul><li>` 顯示
       - 若沒有 bullets，顯示：`（此卡片目前沒有內容）`
     - 下方控制列：
       - 左按鈕：`← 上一張`
       - 右按鈕：`下一張 →`
       - 第一張卡片時「上一張」要 disabled，最後一張時「下一張」要 disabled
   - 如果目前沒有任何卡片可顯示（例如 cards 陣列為空），在卡片區顯示：
     - `目前沒有卡片可顯示（可能是資料尚未產生）。`

---

## 狀態與互動需求

1. **狀態**
   - `currentTopicId`：目前選中的 topic id，或 `"all"` 代表看全部主題。
   - `currentCardIndex`：目前在「可見卡片列表」中的 index（0-based）。

2. **可見卡片集合**
   - 當 `currentTopicId === "all"` 時，`visibleCards = deck.cards`。
   - 否則 `visibleCards = deck.cards.filter(card => card.topicId === currentTopicId)`。
   - 當 `currentTopicId` 被切換時，`currentCardIndex` 重設為 0。

3. **翻卡行為**
   - 點「上一張」：`currentCardIndex = max(currentCardIndex - 1, 0)`。
   - 點「下一張」：`currentCardIndex = min(currentCardIndex + 1, totalCards - 1)`。
   - 如果 `visibleCards.length === 0`，兩個按鈕都 disabled。

4. **主題切換行為**
   - 點「全部主題」按鈕 → `currentTopicId = "all"`，`currentCardIndex = 0`。
   - 點某一主題按鈕 → `currentTopicId = 該 topic.id`，`currentCardIndex = 0`。

---

## P0 使用的假資料（sampleDeck）

P0 階段 **先不用讀檔、先不用 fetch**，直接在前端寫死一個 `sampleDeck`，型別可以先用：

```ts
interface Paragraph {
  id: string;
  text: string;
  summary: string;
  keywords: string[];
  sourceIndex: number;
}

interface Topic {
  id: string;
  title: string;
  memberIds: string[]; // 對應 paragraphs.id
}

interface Card {
  id: string;
  topicId: string;
  title: string;
  bullets: string[];
}

interface DeckStats {
  paragraphCount: number;
  topicCount: number;
  cardCount: number;
}

interface Deck {
  paragraphs: Paragraph[];
  topics: Topic[];
  cards: Card[];
  stats: DeckStats;
}

const sampleDeck: Deck = {
  paragraphs: [],
  topics: [],
  cards: [],
  stats: {
    paragraphCount: 0,
    topicCount: 0,
    cardCount: 0,
  },
};

// TODO: 未來改成 fetch('/deck.json')，目前先使用內建 sampleDeck。 
```
---

## P0 階段 **不需要**：

- 不需要做 RWD / 行動版調整
- 不需要 loading 狀態
- 不需要錯誤提醒視覺設計
- 不需要真的讀檔，只用內建 sampleDeck 即可

---

## P0 完成條件

- 專案可啟動並在瀏覽器看到畫面
- 左側能顯示統計數字與主題列表，點主題可切換顯示卡片
- 右側能看到一張卡片，且可以用「上一張 / 下一張」翻卡
- 所有資料皆來自內建 sampleDeck 變數，尚未連接外部檔案或 API