# Frontend - React + TypeScript 前端介面

## 📋 目前狀態

本資料夾包含基礎的 UI Shell（P0 階段）：
- `src/App.tsx` - 卡片瀏覽介面（已實作）
- `src/types.ts` - 型別定義
- `src/sampleDeck.ts` - 示範資料
- `package.json` - npm 依賴管理

尚未實作完整的功能，請配合本書 CH05 使用 Cloud agent 協同合作

---

## 💡 實作建議

### 目前按照 agent-b.md 做出來的：
基礎的檔案上傳與 API 整合功能：
- 檔案上傳（支援 `.txt` 和 `.md` 檔案）
- 文字輸入框（直接貼上文字）
- 參數調整介面（分群閾值、最大主題數等）
- 呼叫 Backend API 進行處理
- 自動載入並顯示生成的卡片
- 卡片瀏覽、主題切換、統計展示

### 未來擴展：更好的使用者體驗：
當基礎功能穩定後，可考慮優化使用者體驗：
- 拖放（Drag & Drop）檔案上傳
- 即時預覽與編輯
- 處理進度顯示（Loading 狀態）
- 卡片匯出功能

詳細的技術規範與開發規則請參考專案根目錄的 doc/prd/agent-b.md

