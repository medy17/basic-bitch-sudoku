document.addEventListener('DOMContentLoaded', () => {
    // --- Constants & Utils ---
    const SIZE = 9;
    const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    // --- State Management ---
    const state = {
        grid: [],         // Current user grid
        solution: [],     // Full solution
        given: [],        // Boolean grid (true if clue)
        notes: [],        // 3D array [row][col][num]
        history: { undo: [], redo: [] },
        selected: null,   // {r, c}
        settings: {
            noteMode: false,
            autoNotes: false,
            showMistakes: false
        },
        stats: {
            mistakes: 0,
            startTime: 0,
            elapsed: 0,
            timerId: null,
            paused: false
        }
    };

    // --- DOM Elements ---
    const elements = {
        board: document.getElementById('board'),
        keypad: document.getElementById('keypad'),
        timer: document.querySelector('#timer .val'),
        mistakes: document.querySelector('#mistakes .val'),
        difficulty: document.getElementById('difficulty'),

        btnNew: document.getElementById('newGame'),

        btnUndo: document.getElementById('undo'),
        btnErase: document.getElementById('erase'),
        btnNote: document.getElementById('noteMode'),
        btnHint: document.getElementById('hint'),

        btnCheck: document.getElementById('check'),
        btnSolve: document.getElementById('solve'),

        togAutoNotes: document.getElementById('autoNotes'),
        togMistakes: document.getElementById('showMistakes'),

        toast: document.getElementById('toast'),
        modal: document.getElementById('modalOverlay'),
        modalAction: document.getElementById('modalAction')
    };

    // --- Initialization ---
    init();

    function init() {
        setupEventListeners();
        newGame();
    }

    function setupEventListeners() {
        elements.btnNew.addEventListener('click', () => newGame());
        elements.difficulty.addEventListener('change', () => newGame());

        elements.btnNote.addEventListener('click', toggleNoteMode);
        elements.togAutoNotes.addEventListener('change', (e) => {
            state.settings.autoNotes = e.target.checked;
            if(state.settings.autoNotes) generateAllNotes();
            render();
        });
        elements.togMistakes.addEventListener('change', (e) => {
            state.settings.showMistakes = e.target.checked;
            render();
        });

        elements.btnUndo.addEventListener('click', undo);
        elements.btnErase.addEventListener('click', () => inputDigit(0));
        elements.btnHint.addEventListener('click', giveHint);
        elements.btnCheck.addEventListener('click', checkBoard);
        elements.btnSolve.addEventListener('click', solveGame);

        elements.modalAction.addEventListener('click', resumeGame);
        document.querySelector('#timer').addEventListener('click', pauseGame);

        document.addEventListener('keydown', handleKeydown);

        // Create Keypad
        elements.keypad.innerHTML = '';
        DIGITS.forEach(d => {
            const btn = document.createElement('button');
            btn.className = 'num-btn';
            btn.innerHTML = `${d}<span class="rem">9</span>`;
            btn.dataset.num = d;
            btn.onclick = () => inputDigit(d);
            elements.keypad.appendChild(btn);
        });
    }

    // --- Core Game Logic ---

    function newGame() {
        const diff = elements.difficulty.value;

        // Reset State
        state.stats.mistakes = 0;
        state.stats.elapsed = 0;
        state.stats.paused = false;
        state.history = { undo: [], redo: [] };
        state.selected = null;

        // Generate Logic
        const sol = generateSolution();
        state.solution = sol;
        const [puzzle, givenMask] = pokeHoles(sol, diff);

        state.grid = puzzle.map(r => [...r]);
        state.given = givenMask;
        state.notes = createEmptyNotes();

        if (state.settings.autoNotes) generateAllNotes();

        startTimer();
        createBoardDOM();
        render();
        updateUI();
    }

    function inputDigit(num) {
        if (!state.selected) {
            showToast("Pick a box first, hun");
            return;
        }
        const { r, c } = state.selected;

        if (state.given[r][c]) {
            showToast("Can't touch this one!");
            return;
        }

        // Note Mode
        if (state.settings.noteMode && num !== 0) {
            toggleNote(r, c, num);
            return;
        }

        // Normal Input
        const prevVal = state.grid[r][c];
        if (prevVal === num) return; // No change

        pushHistory({ type: 'set', r, c, oldVal: prevVal, newVal: num, notes: cloneNotes(state.notes[r][c]) });

        state.grid[r][c] = num;

        // Clear notes in cell
        if (num !== 0) {
            state.notes[r][c] = new Array(10).fill(false);
            if (state.settings.autoNotes) clearRelatedNotes(r, c, num);
        }

        // Check correctness if enabled or update stats
        if (num !== 0 && num !== state.solution[r][c]) {
            state.stats.mistakes++;
            showToast("That's... not right");
            animateCell(r, c, 'error');
        } else if (num !== 0) {
            animateCell(r, c, 'animate-pop');
        }

        checkWinCondition();
        render();
        updateUI();
    }

    function toggleNote(r, c, num) {
        const prevNotes = [...state.notes[r][c]];
        state.notes[r][c][num] = !state.notes[r][c][num];
        pushHistory({ type: 'note', r, c, num, oldNotes: prevNotes });
        render();
    }

    // --- Undo / History ---
    function pushHistory(action) {
        state.history.undo.push(action);
        state.history.redo = [];
        updateUI();
    }

    function undo() {
        if (state.history.undo.length === 0) return;
        const action = state.history.undo.pop();

        if (action.type === 'set') {
            state.grid[action.r][action.c] = action.oldVal;
            if (action.notes) state.notes[action.r][action.c] = action.notes;
        } else if (action.type === 'note') {
            state.notes[action.r][action.c] = action.oldNotes;
        }

        render();
        updateUI();
    }

    // --- Rendering ---
    function createBoardDOM() {
        elements.board.innerHTML = '';
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.r = r;
                cell.dataset.c = c;

                // Container for the Number
                const valSpan = document.createElement('span');
                valSpan.className = 'cell-value';
                cell.appendChild(valSpan);

                // Note Grid Container
                const noteGrid = document.createElement('div');
                noteGrid.className = 'note-grid';
                for(let i=1; i<=9; i++) {
                    const span = document.createElement('span');
                    span.className = 'note-num';
                    span.dataset.n = i;
                    noteGrid.appendChild(span);
                }
                cell.appendChild(noteGrid);

                // Interaction
                cell.addEventListener('mousedown', () => selectCell(r, c));
                cell.addEventListener('touchstart', (e) => {
                    if(e.touches.length > 1) return;
                    selectCell(r, c);
                }, {passive: true});

                elements.board.appendChild(cell);
            }
        }
    }

    function render() {
        const cells = elements.board.children;
        const { selected } = state;

        const counts = Array(10).fill(0);

        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                const idx = r * SIZE + c;
                const cell = cells[idx];
                const valSpan = cell.querySelector('.cell-value');
                const noteContainer = cell.querySelector('.note-grid');

                const val = state.grid[r][c];
                const isGiven = state.given[r][c];

                if (val !== 0) counts[val]++;

                // Reset Classes
                cell.className = 'cell';
                if (isGiven) cell.classList.add('given');

                // Selection & Highlighting
                if (selected) {
                    if (selected.r === r && selected.c === c) cell.classList.add('selected');
                    else if (selected.r === r || selected.c === c || getBlock(r,c) === getBlock(selected.r, selected.c)) {
                        cell.classList.add('highlight-area');
                    }

                    const selVal = state.grid[selected.r][selected.c];
                    if (selVal !== 0 && val === selVal) cell.classList.add('highlight-same');
                }

                // Render Content
                if (val !== 0) {
                    valSpan.textContent = val;
                    noteContainer.style.display = 'none';

                    if (state.settings.showMistakes && val !== state.solution[r][c]) {
                        cell.classList.add('error');
                    }
                } else {
                    valSpan.textContent = '';
                    noteContainer.style.display = 'grid';
                    const noteSpans = noteContainer.children;
                    for(let i=0; i<9; i++) {
                        noteSpans[i].textContent = state.notes[r][c][i+1] ? (i+1) : '';
                    }
                }
            }
        }

        // Update Keypad Counts
        const keys = elements.keypad.children;
        for(let i=0; i<9; i++) {
            const d = i + 1;
            const rem = 9 - counts[d];
            keys[i].querySelector('.rem').textContent = rem;
            if (rem <= 0) keys[i].classList.add('disabled');
            else keys[i].classList.remove('disabled');
        }
    }

    function updateUI() {
        elements.mistakes.textContent = `${state.stats.mistakes} Oopsies`;
        elements.btnNote.classList.toggle('active', state.settings.noteMode);
        elements.btnUndo.disabled = state.history.undo.length === 0;
    }

    function selectCell(r, c) {
        if (state.selected && state.selected.r === r && state.selected.c === c) return;
        state.selected = { r, c };
        render();
    }

    // --- Helpers ---
    function getBlock(r, c) { return Math.floor(r/3)*3 + Math.floor(c/3); }
    function animateCell(r, c, cls) {
        const cell = elements.board.children[r*SIZE + c];
        cell.classList.remove(cls);
        void cell.offsetWidth;
        cell.classList.add(cls);
    }

    function showToast(msg) {
        elements.toast.textContent = msg;
        elements.toast.classList.add('show');
        setTimeout(() => elements.toast.classList.remove('show'), 2000);
    }

    // --- Game Loop Utils ---
    function startTimer() {
        clearInterval(state.stats.timerId);
        state.stats.startTime = Date.now() - state.stats.elapsed;
        state.stats.timerId = setInterval(() => {
            state.stats.elapsed = Date.now() - state.stats.startTime;
            const s = Math.floor(state.stats.elapsed / 1000);
            const m = Math.floor(s / 60);
            const sec = s % 60;
            elements.timer.textContent = `${m.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`;
        }, 1000);
    }

    function pauseGame() {
        if (state.stats.paused) return;
        state.stats.paused = true;
        clearInterval(state.stats.timerId);
        elements.modal.classList.add('open');
        document.getElementById('modalTitle').textContent = "Hold Up ✋";
        document.getElementById('modalText').textContent = "We taking a break?";
        elements.modalAction.textContent = "Let's Go";
    }

    function resumeGame() {
        elements.modal.classList.remove('open');
        if (state.stats.paused) {
            state.stats.paused = false;
            startTimer();
        }
    }

    function checkWinCondition() {
        let filled = 0;
        let correct = 0;
        for(let r=0; r<SIZE; r++){
            for(let c=0; c<SIZE; c++){
                if(state.grid[r][c] !== 0) {
                    filled++;
                    if(state.grid[r][c] === state.solution[r][c]) correct++;
                }
            }
        }

        if (filled === 81 && correct === 81) {
            clearInterval(state.stats.timerId);
            document.getElementById('modalTitle').textContent = "OMG Slay! 🎉";
            document.getElementById('modalText').textContent = `Time: ${elements.timer.textContent} | Oopsies: ${state.stats.mistakes}`;
            elements.modalAction.textContent = "New Game, Pls";
            elements.modalAction.onclick = () => {
                elements.modal.classList.remove('open');
                elements.modalAction.onclick = resumeGame;
                newGame();
            };
            elements.modal.classList.add('open');
            confettiEffect();
        }
    }

    // --- Keyboard ---
    function handleKeydown(e) {
        if (state.stats.paused) return;

        const key = e.key;
        if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key)) {
            e.preventDefault();
            if (!state.selected) { selectCell(0,0); return; }
            let {r, c} = state.selected;
            if (key === 'ArrowUp') r = Math.max(0, r-1);
            if (key === 'ArrowDown') r = Math.min(8, r+1);
            if (key === 'ArrowLeft') c = Math.max(0, c-1);
            if (key === 'ArrowRight') c = Math.min(8, c+1);
            selectCell(r, c);
        } else if (key >= '1' && key <= '9') {
            inputDigit(parseInt(key));
        } else if (key === 'Backspace' || key === 'Delete') {
            inputDigit(0);
        } else if (key.toLowerCase() === 'n') {
            toggleNoteMode();
        } else if ((e.metaKey || e.ctrlKey) && key === 'z') {
            undo();
        }
    }

    function toggleNoteMode() {
        state.settings.noteMode = !state.settings.noteMode;
        updateUI();
        showToast(state.settings.noteMode ? "K, notes are on" : "Notes are off, btw");
    }

    // --- Generator Logic ---
    function createEmptyNotes() {
        return Array.from({length: SIZE}, () => Array.from({length: SIZE}, () => new Array(10).fill(false)));
    }

    function cloneNotes(n) { return [...n]; }

    function generateSolution() {
        const grid = Array.from({length: SIZE}, () => Array(SIZE).fill(0));
        fillGrid(grid);
        return grid;
    }

    function fillGrid(grid) {
        const empty = findEmpty(grid);
        if (!empty) return true;
        const [r, c] = empty;
        const nums = shuffle(DIGITS.slice());

        for (let n of nums) {
            if (isValid(grid, r, c, n)) {
                grid[r][c] = n;
                if (fillGrid(grid)) return true;
                grid[r][c] = 0;
            }
        }
        return false;
    }

    function pokeHoles(sol, diff) {
        const puzzle = sol.map(row => [...row]);
        const given = Array.from({length: SIZE}, () => Array(SIZE).fill(true));

        let attempts = diff === 'easy' ? 30 : diff === 'medium' ? 45 : diff === 'hard' ? 55 : 64;

        while(attempts > 0) {
            let r = Math.floor(Math.random() * SIZE);
            let c = Math.floor(Math.random() * SIZE);
            if (puzzle[r][c] !== 0) {
                puzzle[r][c] = 0;
                given[r][c] = false;
                attempts--;
            }
        }
        return [puzzle, given];
    }

    function isValid(grid, r, c, num) {
        for (let i = 0; i < 9; i++) if (grid[r][i] === num || grid[i][c] === num) return false;
        const br = Math.floor(r/3)*3, bc = Math.floor(c/3)*3;
        for (let i = 0; i < 3; i++)
            for (let j = 0; j < 3; j++)
                if (grid[br+i][bc+j] === num) return false;
        return true;
    }

    function findEmpty(grid) {
        for (let r = 0; r < 9; r++)
            for (let c = 0; c < 9; c++)
                if (grid[r][c] === 0) return [r, c];
        return null;
    }

    function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    // --- Auto Notes Logic ---
    function generateAllNotes() {
        for(let r=0; r<9; r++){
            for(let c=0; c<9; c++){
                if(state.grid[r][c] === 0) {
                    for(let n=1; n<=9; n++) {
                        state.notes[r][c][n] = isValid(state.grid, r, c, n);
                    }
                }
            }
        }
    }

    function clearRelatedNotes(r, c, num) {
        for(let i=0; i<9; i++) {
            state.notes[r][i][num] = false;
            state.notes[i][c][num] = false;
        }
        const br = Math.floor(r/3)*3, bc = Math.floor(c/3)*3;
        for(let i=0; i<3; i++)
            for(let j=0; j<3; j++)
                state.notes[br+i][bc+j][num] = false;
    }

    // --- Tools ---
    function giveHint() {
        const empties = [];
        for(let r=0; r<9; r++)
            for(let c=0; c<9; c++)
                if(state.grid[r][c] === 0) empties.push({r,c});

        if(empties.length === 0) return;

        const target = empties[Math.floor(Math.random() * empties.length)];
        state.selected = target;
        inputDigit(state.solution[target.r][target.c]);
        showToast("There you go, sweetie");
    }

    function checkBoard() {
        let errs = 0;
        for(let r=0; r<9; r++) {
            for(let c=0; c<9; c++) {
                if(state.grid[r][c] !== 0 && state.grid[r][c] !== state.solution[r][c]) {
                    errs++;
                    animateCell(r, c, 'error');
                }
            }
        }
        showToast(errs > 0 ? `Ugh, ${errs} mistakes` : "Looks good to me!");
    }

    function solveGame() {
        if(!confirm("Seriously? You're giving up?")) return;
        state.grid = state.solution.map(r => [...r]);
        state.stats.paused = true;
        clearInterval(state.stats.timerId);
        render();
        showToast("Fine, I did it for you 🙄");
    }

    function confettiEffect() {
        const colors = ['#E91E63', '#FF80AB', '#F8BBD0'];
        for(let i=0; i<50; i++) {
            const el = document.createElement('div');
            el.style.position = 'fixed';
            el.style.left = '50%';
            el.style.top = '50%';
            el.style.width = '10px';
            el.style.height = '10px';
            el.style.backgroundColor = colors[Math.floor(Math.random()*3)];
            el.style.transition = 'all 1s ease-out';
            el.style.zIndex = '300';
            document.body.appendChild(el);

            setTimeout(() => {
                const x = (Math.random() - 0.5) * window.innerWidth;
                const y = (Math.random() - 0.5) * window.innerHeight;
                el.style.transform = `translate(${x}px, ${y}px) scale(0)`;
            }, 10);
            setTimeout(() => el.remove(), 1000);
        }
    }
});