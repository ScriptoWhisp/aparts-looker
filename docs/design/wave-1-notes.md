# Wave 1 — Заметки по реализации

## Созданные и изменённые файлы

### Созданные

| Файл | Описание |
|------|----------|
| `frontend/css/tokens.css` | Единственный источник дизайн-токенов. Слой 1 — Nocturne (цветовые рампы, типографика, тени). Слой 2 — алиасы Aparts Looker (canvas/app-bg/sunken/surface/border/hairline). Слой 3 — score-рамп, статусные токены, спейсинг, радиусы, motion. Плюс базовые сбросы, утилитарные классы (.card, .btn, .tag, .score-badge, .metric, .left-rule) и стили хедера / таб-навигации. |

### Изменённые

| Файл | Изменения |
|------|-----------|
| `frontend/index.html` | Замена Google Fonts (IBM Plex Mono + Space Grotesk → Inter + JetBrains Mono). Добавлена ссылка на `/css/tokens.css`. Блок `:root` в инлайн-стилях заменён на мост-алиасы (`--bg`, `--surface`, … → новые токены). Разметка шапки переработана: `<div class="header">` → `<header class="header">` с `.app-brand` + `.tab-nav` + `.header-right`. Кнопка Pending получила инлайн-бейдж `.tab-pending-count`. Функция `scoreColor()` обновлена до канонических цветов score-рампа. Добавлена `_updatePendingBadge()`, вызываемая после `loadData`. |
| `frontend/js/ui.js` | Добавлены `window.scoreBucket(score)` и `window.scoreColor(score)` с каноническими значениями Nocturne score-рампы. Они определены до остального кода модуля и экспортируются как глобальные функции. |

## Отклонения от брифа

### 1. Кнопки действий в шапке — убраны эмодзи

**Бриф:** не специфицировал кнопки (TG, Backfill, Clear all) как часть дизайна.
**Факт:** кнопки существовали в исходном коде. Убраны эмодзи (бриф прямо запрещает эмодзи в chrome). Текст заменён на короткие английские метки (TG / Commutes / Costs / Clear all).
**Почему:** проект уже не первый день. Убирать эти кнопки — задача Wave 5+ (Settings redesign).

### 2. `color: white` на `.score-badge`

**Бриф:** score-цвета используются как «2px left rule, pin fill, dial arc and numeral», явно не упоминает цвет текста.
**Факт:** у `.score-badge` принят `color: #fff`. Тёмные числа (#160f0f) из брифа используются в mockup'ах как цвет текста *поверх* score-заливки на горизонтальной полосе (большой hero). Для компактного бейджа (размер ~26-32 px) белый текст читается лучше.
**Почему:** в mockup 1b пины на карте используют тёмный текст (`#0f160f`) поверх score-цвета. Для Wave 2 можно уточнить per-bucket — сейчас `#fff` во всех случаях.

### 3. Bridge-алиасы вместо полной замены переменных

**Бриф:** Wave 1 — только фундамент, не затрагивать контент табов.
**Факт:** инлайн-блок `<style>` содержит 1200+ строк с `var(--bg)`, `var(--surface-2)` и т.д. Полная замена переменных = Wave 2/3/4. Применены bridge-алиасы: старые имена → новые токены.
**Почему:** так гарантируется, что весь существующий UI продолжает работать на новой палитре без риска сломать компоненты.

### 4. `--color-section` (deck-divider) не экспортирован в tokens.css

**Бриф:** Nocturne определяет `--color-section` для deck-level заливок.
**Факт:** токен опущен — он не нужен в интерфейсе дашборда. Deck-level шаблоны (#262a60 / #353b80 / #4c5397) — для презентационных слайдов Nocturne, не для UI-приложения.

## Рабочие токены для Wave 2/3/4

### Цвета (готовы)

```css
var(--color-canvas)         /* #0f111c  — самый глубокий фон */
var(--color-app-bg)         /* #161826  — фон страницы */
var(--color-sunken)         /* #1d1f2d  — sunken wells, card fills */
var(--color-surface)        /* #232532  — elevated surface */
var(--color-border)         /* #3f424d  — visible borders */
var(--color-hairline)       /* #292b31  — thin dividers */
var(--color-text)           /* #e9e9ed  — primary text */
var(--color-text-secondary) /* #9397ab  — secondary text */
var(--color-text-muted)     /* #75798c  — labels/kickers */
var(--color-accent)         /* #9184d9  — blurple accent */
var(--color-accent-400)     /* #b5abfc  — accent на тёмном фоне */
var(--color-accent-tint)    /* rgba(145,132,217,.14) — active nav pill */
```

### Score-рамп

```css
var(--score-0)   /* #c4635f  — bad  (0-39) */
var(--score-40)  /* #c98b52  — poor (40-59) */
var(--score-60)  /* #c9b455  — ok   (60-74) */
var(--score-75)  /* #7fbf7a  — good (75-84) */
var(--score-85)  /* #4fb98d  — great (85-100) */
```

### Статусные токены

```css
var(--status-pending-bg / -text / -border)
var(--status-approved-bg / -text / -border)
var(--status-rejected-bg / -text / -border)
var(--status-viewing-bg / -text / -border)
var(--status-viewed-bg / -text / -border)
```

### Спейсинг

```css
var(--space-1)   /* 4px  */
var(--space-2)   /* 8px  */
var(--space-3)   /* 12px */
var(--space-4)   /* 16px */
var(--space-6)   /* 24px */
var(--space-8)   /* 32px */
var(--space-12)  /* 48px */
```

### Радиусы, тени, motion

```css
var(--radius-sm)      /* 4px  — chips, micro-pills */
var(--radius-md)      /* 8px  — cards, buttons, inputs */
var(--radius-lg)      /* 14px — hero, large modals */
var(--shadow-sm/md/lg)
var(--transition-fast) /* 120ms cubic-bezier(.2,.7,.3,1) */
var(--transition-med)  /* 160ms */
```

### Утилитарные классы (готовы к использованию)

| Класс | Описание |
|-------|----------|
| `.card` | Sunken bg, radius-md, hairline shadow, padding 12/16 |
| `.card-kicker` | 10px 600 uppercase letterspaced, muted |
| `.card-title` | Inter 500 17px |
| `.btn` + `.btn-primary/secondary/ghost` | Outlined accent / subtle grey / no-border |
| `.tag` + `.tag-pending/approved/rejected/viewing/viewed` | Status pills |
| `.score-badge` + `data-score-bucket="bad/poor/ok/good/great"` | Score display |
| `.metric` + `.metric-value` + `.metric-label` | KPI cell |
| `.left-rule` + `--rule-color` | 2px score-coloured left border |
| `.mono` | JetBrains Mono + tabular-nums |

### JS-хелперы (готовы)

```js
window.scoreBucket(score)  // → "bad" | "poor" | "ok" | "good" | "great"
window.scoreColor(score)   // → hex (для SVG и инлайн-стилей)
```

## Передача Wave 2

**Wave 2 (Overview tab redesign)** должна:
1. Использовать `var(--color-sunken)` для chart panels вместо `var(--surface)`.
2. Применять `.score-badge[data-score-bucket="..."]` вместо инлайн `style.background = scoreColor()` там, где это не SVG.
3. KPI-карточки рефакторить на `.card` + `.metric` + `.card-kicker`.
4. Заменить старые bridge-алиасы (`--bg`, `--surface-2`, `--blue` и т.д.) в компонентах Overview на канонические Nocturne-токены.
5. Не трогать bridge-алиасы в `:root` пока они нужны другим табам.

**Wave 3 (Detail tab)** и **Wave 4 (Pending tab)** аналогично — вытеснять bridge-алиасы постепенно.

После завершения всех волн блок bridge-алиасов и инлайн-блок `<style>` можно будет полностью удалить.
