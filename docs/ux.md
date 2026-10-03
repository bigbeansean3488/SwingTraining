# UX: practice-first interface

Target: iPhone Safari, portrait, outdoor/night practice, phone on a tripod a
few steps away. Main workflow: **start recording, hit N balls, stop, analyze
the whole recording** — re-recording for every swing would break the batting
rhythm. Single-swing clips (≤ 10 s) are still supported. Primary language:
Traditional Chinese (Taiwan) with established baseball/technical terms kept in
English. Usability with real players during practice is **not yet validated**.

## Information architecture

```
訓練 (tab)
├── Setup            (no active session)
│   ├── 今天誰要練？   player shortcuts (most recent first) · Guest 訪客 · 或輸入球員名稱
│   ├── 打擊側         [右打] [左打]  (defaults to the player's last side)
│   ├── 今天想看什麼？ Training Focus: Motion / Head Stability / Stride / Hand Path
│   ├── [開始訓練]     single primary action
│   └── 繼續之前的 Session (secondary)
└── Practice         (active session)
    ├── status card    short clip: 影片載入 → Pose Tracking (%) → 計算 Metrics
    │                  recording:  影片載入 → 找出每一棒 (%) → 逐棒分析 (第 k / N 棒) · [停止分析]
    │                  (stopping keeps the swings already analyzed)
    ├── video panel    only while loading/scanning/tracking, for replay, or on demand
    ├── 這段影片       after a recording: 找到 N 棒 · one row per swing: [▶ 回看] Swing #n · focus score
    │                  / Baseline / ⚠ 不穩定 · [扎實][普通][沒打好] · tap Swing #n → detail (delete
    │                  dry swings / false detections) · [完成] → newest result
    ├── newest result  Swing #N · QC badge · 今日重點 (focus, large) · trend vs 最近 5 棒
    │                  · 3 secondary metrics · 這一棒擊球感覺？ [扎實][普通][沒打好]
    ├── 最近 5 棒      focus score bars + contact, tap → swing detail
    └── [＋ 加入影片]   fixed at the bottom; opens camera/library; recordings > 10 s → every swing
                       found automatically; clips ≤ 10 s → that one swing
紀錄 (tab) — Review
    ├── 今日 Session   Swings · focus trend (first → last) · Good Contact · Best Consistency
    ├── insights       largest variation source; descriptive contact split (≥ 6 labeled, no causal claim)
    ├── focus trend chart · 所有 Swing (tap → detail) · Contact Quality 對照
設定 (tab)
    ├── 目前 Session   重新命名 · 變更 Training Focus · 匯出資料 · 結束 Session (confirm)
    ├── 球員           shortcut list (remove)
    ├── 資料           local-only note · 過去的 Session
    └── Developer Tools (toggle, or ?debug=1)
        ├── Synthetic Swing buttons (+ Recording ×5 swings)
        ├── 長影片：自動找出每一棒 (off → manual: scrub to one swing, 進階 From/To)
        ├── Pose model (lite / full / heavy)
        ├── Environment checks
        └── Diagnostics (last video/analysis JSON, version, validation status)
Swing detail (sheet) — result, skeleton replay with hand paths, 詳細數據,
    Debug events/deviations (debug only), 不要把這一棒列入 Baseline, 刪除這一棒 (confirm)
Session ⋯ (top bar chip) — 查看 Session 紀錄 · 匯出資料 · 重新命名 · 變更 Training Focus · 結束 Session
```

## Old → new feature map

| Previous UI | Now |
|---|---|
| Start card: name, batting side select, note | Setup: player chips + text field, 右打/左打 toggle, Training Focus (note dropped from the form; field kept in data) |
| Previous sessions list | Setup "繼續之前的 Session", 紀錄 (no session), 設定 → 資料 |
| Export / New session buttons beside capture | Session ⋯ menu and 設定; ending asks for confirmation and states data is kept |
| "Record / choose swing video" | ＋ 加入影片 (bottom); recordings find every swing; clips ≤ 10 s analyze that swing |
| From / To + Analyze for long clips | Automatic swing finding; manual chooser (scrub → 分析這個位置的 Swing, From/To under 進階) remains as fallback when no swing is found (手動選擇位置) or when turned off in Developer Tools |
| Progress bar + console-like status | Stage list (real pipeline steps) |
| Result card (English) | Focus-first result card in Traditional Chinese; failed QC never shows a score |
| Details (raw metrics, deviations, events, exclude, delete) | Swing detail sheet; deviations/events/components under Debug only |
| Static replay card | Swing detail sheet |
| Recent swings list | 最近 5 棒 strip (practice) + full list in 紀錄 |
| Metrics vs contact label | 紀錄 → Contact Quality 對照 |
| Options → Pose model | 設定 → Developer Tools |
| Demo synthetic swing buttons | 設定 → Developer Tools |
| Environment line | 設定 → Developer Tools |

## Terminology

Kept in English: Session, Swing, Motion Consistency, Head Stability, Stride
(Consistency), Hand Path (Consistency), Contact Quality, Good / Medium / Poor,
Pose, Pose Tracking, Tracking, Baseline, QC, FPS, Developer Tools, Debug,
Metrics, Training Focus.

Chinese UI: 訓練 / 紀錄 / 設定, 今天誰要練？, 打擊側 右打 / 左打, 今天想看什麼？,
開始訓練, ＋ 加入影片, 正在找出影片中的每一棒…, 找到 N 棒, 逐棒分析, 停止分析, 這段影片, 回看, 正在分析這一棒…, 今日重點, 比最近 5 棒平均 +6,
這一棒擊球感覺？ 扎實 Good / 普通 Medium / 沒打好 Poor, Tracking 良好,
這一棒 Tracking 不穩定, 這一棒不會加入 Baseline。, 查看原因, 最近 5 棒,
今日 Session, 結束目前 Session？.

Feedback wording describes measurable differences only, e.g.
「這一棒的 Stride 比最近 Baseline 稍長」「Head movement 比最近 4 棒都多」
「Hand Path 與最近 Swing 相近」. No coaching diagnosis. Review insights are
explicitly descriptive (「僅為描述，不代表因果」).

## Accessibility / practice ergonomics

- Primary buttons 64 px tall; all controls ≥ 44 px; ＋ 加入影片 fixed above the tab bar; recording-list label buttons 48 px.
- QC and contact state use icon + text + color (✓ / ! / ⚠, ✓ on the selected contact), never color alone.
- Visible focus outline; semantic buttons; dialogs are modal with Escape to dismiss.
- High-contrast dark theme; main score 72–96 px.
- Verified in headless Chrome at 375 / 390 / 430 px: no horizontal overflow
  (`tools/check-practice.mjs`). Not yet tested on a physical iPhone outdoors.
