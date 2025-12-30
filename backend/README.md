# Backend - Python 後端處理

## 📋 目前狀態

本資料夾目前僅包含基礎檔案：
- `main.py` - 主程式入口（預留）
- `pyproject.toml` - uv 依賴管理設定

尚未實作完整的功能，請配合本書 CH05 使用 Cloud agent 協同合作
---

## 💡 實作建議

### 目前按照 agent-a.md 做出來的：
基礎的文字處理功能：
- 段落切分（依空行、標題）
- 文字統計與關鍵詞提取
- 簡易的分組與摘要邏輯
- 輸出 JSON 格式

### 未來擴展：LLM 整合的可能：
當基礎功能穩定後，可考慮整合大語言模型 API 來提升處理品質：
- 連接 OpenAI、Claude、Gemini 等 LLM API
- 使用 Embedding 進行語意分群
- 智能摘要與重點提取
- 結構化輸出

---

詳細的技術規範與開發規則請參考專案根目錄的 doc/prd/agent-a.md
