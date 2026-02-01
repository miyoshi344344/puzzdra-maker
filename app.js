// ====== ドロップ定義 ======
const DROPS = [
    { key: "fire", label: "火", dot: "#ff4b2b" },
    { key: "water", label: "水", dot: "#2a7fff" },
    { key: "wood", label: "木", dot: "#3ac55b" },
    { key: "dark", label: "闇", dot: "#7c3aed" },
    { key: "light", label: "光", dot: "#f6c92b" },
    { key: "heal", label: "回復", dot: "#ff5fa2" },
    { key: "empty", label: "消す", dot: "#2a2f3a" }, // 自由配置の消しゴム
];

// ====== 状態 ======
let W = 6, H = 5;                         // 初期：縦5×横6
let mode = "random";                      // "random" | "free"
let penColor = "fire";
let allowed = new Set(["fire", "water", "wood", "dark", "light", "heal"]); // ランダム対象は6色のみ
let cells = [];
let isReplaying = false;

// ドラッグ
let dragging = false;
let dragIndex = null;
let movePath = [];
let snapshotBeforeMove = null;
let lastMove = null;

// 再生
const REPLAY_DELAY_MS = 120;

// ====== 要素 ======
const boardEl = document.getElementById("board");
const statsEl = document.getElementById("stats");

const btn76 = document.getElementById("btn76");
const btn56 = document.getElementById("btn56");
const btn54 = document.getElementById("btn54");

const modeRandomBtn = document.getElementById("modeRandom");
const modeFreeBtn = document.getElementById("modeFree");

const clearBtn = document.getElementById("clear");

const checksEl = document.getElementById("colorChecks");
const penEl = document.getElementById("pen");

const undoBtn = document.getElementById("undo");
const playBtn = document.getElementById("play");
const clearPathBtn = document.getElementById("clearPath");
const pathInfoEl = document.getElementById("pathInfo");

// ====== 便利関数 ======
const idx = (x, y) => y * W + x;

function inBounds(x, y) { return 0 <= x && x < W && 0 <= y && y < H; }

function indexToXY(i) { return { x: i % W, y: Math.floor(i / W) }; }

function isNeighbor(a, b) {
    const A = indexToXY(a), B = indexToXY(b);
    const dx = Math.abs(A.x - B.x);
    const dy = Math.abs(A.y - B.y);
    return (dx + dy) === 1;
}

function swap(i, j) {
    const t = cells[i];
    cells[i] = cells[j];
    cells[j] = t;
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

/**
 * 精度改善：座標→セルindex
 * gap領域は null（無視）
 */
function getIndexFromPoint(clientX, clientY) {
    const rect = boardEl.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;

    const cs = getComputedStyle(boardEl);
    const cellSize = parseFloat(cs.getPropertyValue("--cell")) || 50;
    const gap = parseFloat(cs.gap) || 8;

    const step = cellSize + gap;

    const x = Math.floor(px / step);
    const y = Math.floor(py / step);

    if (!inBounds(x, y)) return null;

    const innerX = px - x * step;
    const innerY = py - y * step;

    // gap上なら無視
    if (innerX < 0 || innerY < 0 || innerX > cellSize || innerY > cellSize) return null;

    return idx(x, y);
}

/**
 * 飛び越え補間：targetへ1マスずつ近づく（横優先→縦）
 */
function stepToward(from, to) {
    const A = indexToXY(from);
    const B = indexToXY(to);
    let nx = A.x, ny = A.y;

    if (B.x > A.x) nx++;
    else if (B.x < A.x) nx--;
    else if (B.y > A.y) ny++;
    else if (B.y < A.y) ny--;

    return idx(nx, ny);
}

function moveDragToward(targetIndex) {
    if (!dragging || isReplaying) return;
    if (targetIndex == null) return;
    if (targetIndex === dragIndex) return;

    let guard = 0;
    while (dragIndex !== targetIndex && guard < 80) {
        const next = isNeighbor(dragIndex, targetIndex)
            ? targetIndex
            : stepToward(dragIndex, targetIndex);

        if (!isNeighbor(dragIndex, next)) break;

        swap(dragIndex, next);
        dragIndex = next;
        movePath.push(next);

        guard++;
    }

    render(dragIndex);
    updateStats();
}

// ====== 盤面セットアップ ======
function setBoardSize(w, h) {
    W = w; H = h;
    boardEl.style.gridTemplateColumns = `repeat(${W}, var(--cell))`;
    cells = Array(W * H).fill("empty");
    render();
    if (mode === "random") randomFill();
    updateStats();
    syncSizeButtons();
    clearRecordedMove();
}

function syncSizeButtons() {
    btn76.classList.toggle("primary", (W === 7 && H === 6));
    btn56.classList.toggle("primary", (W === 6 && H === 5));
    btn54.classList.toggle("primary", (W === 5 && H === 4));
}

function setMode(next) {
    mode = next;
    const isRandom = (mode === "random");
    modeRandomBtn.setAttribute("aria-pressed", String(isRandom));
    modeFreeBtn.setAttribute("aria-pressed", String(!isRandom));

    // ランダム生成ボタンを押したら即生成
    if (isRandom) randomFill();
    updateStats();
}

function randomFill() {
    const pool = Array.from(allowed);
    if (pool.length === 0) {
        alert("ランダム生成に使う色が0です。最低1色チェックしてください。");
        return;
    }
    for (let i = 0; i < cells.length; i++) {
        cells[i] = pool[Math.floor(Math.random() * pool.length)];
    }
    render();
    updateStats();
    clearRecordedMove();
}

function clearBoard() {
    cells = Array(W * H).fill("empty");
    render();
    updateStats();
    clearRecordedMove();
}

// ====== 描画 ======
function render(selectedIndex = null) {
    boardEl.innerHTML = "";
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = idx(x, y);
            const d = document.createElement("div");
            d.className = `cell ${cells[i] || "empty"}`;
            d.dataset.index = String(i);
            if (selectedIndex === i) d.classList.add("selected");
            boardEl.appendChild(d);
        }
    }
}

function updateStats() {
    const counts = {};
    for (const d of DROPS) counts[d.key] = 0;
    for (const c of cells) if (counts[c] != null) counts[c]++;

    // 6色だけ表示（消す/emptyは表示しない）
    const showKeys = ["fire", "water", "wood", "dark", "light", "heal"];
    const labelMap = { fire: "火", water: "水", wood: "木", dark: "闇", light: "光", heal: "回復" };
    statsEl.textContent = showKeys.map(k => `${labelMap[k]}:${counts[k] ?? 0}`).join("  ");

    updatePathInfo();
}

function updatePathInfo() {
    if (!pathInfoEl) return;
    if (!lastMove || !lastMove.path || lastMove.path.length < 2) {
        pathInfoEl.textContent = "動作：未保存（ドラッグで動かすと記録）";
        return;
    }
    pathInfoEl.textContent = `動作：${lastMove.path.length - 1} step`;
}

// ====== UI構築：チェック & ペン ======
function buildColorChecks() {
    checksEl.innerHTML = "";
    for (const d of DROPS) {
        if (d.key === "empty") continue; // ランダム対象にしない
        const label = document.createElement("label");
        label.className = "chip";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = allowed.has(d.key);
        cb.addEventListener("change", () => {
            if (cb.checked) allowed.add(d.key);
            else allowed.delete(d.key);
        });

        const dot = document.createElement("span");
        dot.className = "dot";
        dot.style.background = d.dot;

        const txt = document.createElement("span");
        txt.textContent = d.label;

        label.appendChild(cb);
        label.appendChild(dot);
        label.appendChild(txt);
        checksEl.appendChild(label);
    }
}

function buildPenPicker() {
    penEl.innerHTML = "";
    for (const d of DROPS) {
        const b = document.createElement("button");
        b.textContent = d.label;
        b.dataset.pen = d.key;
        b.addEventListener("click", () => {
            penColor = d.key;
            syncPenButtons();
        });
        penEl.appendChild(b);
    }
    syncPenButtons();
}

function syncPenButtons() {
    for (const b of penEl.querySelectorAll("button")) {
        b.classList.toggle("primary", b.dataset.pen === penColor);
    }
}

// ====== 動きの記録 ======
function clearRecordedMove() {
    snapshotBeforeMove = null;
    lastMove = null;
    updatePathInfo();
}

function saveCurrentMove(path, snapshot) {
    lastMove = { path: [...path], snapshot: [...snapshot] };
    updatePathInfo();
}

// ====== ドラッグ操作 ======
function startDragAt(index) {
    if (isReplaying) return;
    if (index == null) return;

    dragging = true;
    dragIndex = index;
    movePath = [index];
    snapshotBeforeMove = [...cells];

    render(dragIndex);
}

function endDrag() {
    if (!dragging) return;

    const startIndex = movePath[0];
    const moved = movePath.length >= 2;

    dragging = false;

    if (moved && snapshotBeforeMove) {
        saveCurrentMove(movePath, snapshotBeforeMove);
    } else {
        // 動いてない＝タップ扱い：自由配置ならペン置き（消しゴム含む）
        if (mode === "free" && startIndex != null && !isReplaying) {
            cells[startIndex] = penColor; // penColorがemptyなら消える
            clearRecordedMove();          // 盤面をいじったら過去動作は無効
        }
        snapshotBeforeMove = null;
    }

    dragIndex = null;
    render(null);
    updateStats();
}

boardEl.addEventListener("pointerdown", (e) => {
    if (isReplaying) return;

    const i = getIndexFromPoint(e.clientX, e.clientY);
    if (i == null) return;

    boardEl.setPointerCapture(e.pointerId);
    startDragAt(i);
    e.preventDefault();
});

boardEl.addEventListener("pointermove", (e) => {
    if (!dragging || isReplaying) return;

    const i = getIndexFromPoint(e.clientX, e.clientY);
    if (i == null) return;

    moveDragToward(i);
    e.preventDefault();
});

boardEl.addEventListener("pointerup", (e) => {
    endDrag();
    e.preventDefault();
});

boardEl.addEventListener("pointercancel", () => {
    endDrag();
});

// ====== Undo / Replay ======
async function undoToSnapshot() {
    if (isReplaying) return;
    if (!lastMove || !lastMove.snapshot) {
        alert("戻す対象がありません（まずドラッグで動かしてください）");
        return;
    }
    cells = [...lastMove.snapshot];
    render(null);
    updateStats();
}

async function replayMove() {
    if (isReplaying) return;
    if (!lastMove || !lastMove.path || lastMove.path.length < 2) {
        alert("再生する動作がありません（まずドラッグで動かしてください）");
        return;
    }

    isReplaying = true;
    boardEl.classList.add("replaying");

    // 開始状態に戻す
    cells = [...lastMove.snapshot];
    render(lastMove.path[0]);
    updateStats();
    await sleep(REPLAY_DELAY_MS);

    for (let k = 1; k < lastMove.path.length; k++) {
        const prev = lastMove.path[k - 1];
        const next = lastMove.path[k];
        if (!isNeighbor(prev, next)) break;

        swap(prev, next);
        render(next);
        updateStats();
        await sleep(REPLAY_DELAY_MS);
    }

    render(null);
    updateStats();
    boardEl.classList.remove("replaying");
    isReplaying = false;
}

// ====== ボタン ======
btn76.addEventListener("click", () => setBoardSize(7, 6));
btn56.addEventListener("click", () => setBoardSize(6, 5));
btn54.addEventListener("click", () => setBoardSize(5, 4));

modeRandomBtn.addEventListener("click", () => setMode("random"));
modeFreeBtn.addEventListener("click", () => setMode("free"));

clearBtn.addEventListener("click", clearBoard);

undoBtn.addEventListener("click", undoToSnapshot);
playBtn.addEventListener("click", replayMove);
clearPathBtn.addEventListener("click", () => {
    clearRecordedMove();
    alert("動作をクリアしました。");
});

// ====== 初期化 ======
buildColorChecks();
buildPenPicker();
setBoardSize(6, 5);
setMode("random");   // 初期はランダム生成モード
randomFill();        // 起動時に6色陣ランダム生成
