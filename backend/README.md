# Backend - Agent A API

此模組依照 `docs/prd/agent-a.md` 實作文字處理後端，提供 FastAPI endpoint：

- `POST /api/process`
- 接收純文字 `text` 與可選參數
- 產生符合 `frontend/src/types.ts` 的 `Deck` JSON
- 固定輸出至 `frontend/public/deck.json`（UTF-8、2 空格縮排、`sort_keys=True`）

## 啟動方式（uv）

```bash
cd backend
uv sync
uv run uvicorn api:app --reload --host 127.0.0.1 --port 8000
```

也可執行：

```bash
cd backend
uv run python main.py
```

## API 規格摘要

### Request

```json
{
  "text": "要處理的純文字內容",
  "topic_threshold": 0.75,
  "max_topics": 5,
  "max_bullets": 5,
  "debug": false
}
```

### Response（成功）

```json
{
  "success": true,
  "message": "處理完成，已更新 deck.json",
  "outputPath": "/workspace/frontend/public/deck.json",
  "stats": {
    "paragraphCount": 3,
    "topicCount": 2,
    "cardCount": 2
  },
  "deck": {
    "paragraphs": [],
    "topics": [],
    "cards": [],
    "stats": {
      "paragraphCount": 3,
      "topicCount": 2,
      "cardCount": 2
    }
  },
  "debug": null
}
```

### 錯誤碼

- `400`：參數驗證失敗或輸入內容無效（如空字串）
- `500`：未預期的內部錯誤

## 目前功能

1. 段落切分（標題/空行/清單）
2. 摘要與關鍵詞提取（每段 1 句摘要 + 1~5 關鍵詞）
3. deterministic hashing 向量化與閾值分群（支援 `topic_threshold` / `max_topics`）
4. 卡片生成（每主題 1 張，若段落 > 8 自動拆成上下兩張）
5. 統計計算（paragraph/topic/card）
6. 固定輸出到 `frontend/public/deck.json`

## 注意事項

- 僅接受純文字，不接受檔案路徑與 URL。
- 不提供自訂輸出路徑參數。
- 已設定 CORS 允許：
  - `http://localhost:5173`
  - `http://127.0.0.1:5173`
