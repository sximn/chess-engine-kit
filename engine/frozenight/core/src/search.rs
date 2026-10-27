use crate::clock::Instant;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use cozy_chess::{Board, Move, Square};

use crate::position::Position;
use crate::tt::{NodeKind, TableEntry};
use crate::{Eval, Frozenight, SharedState, Statistics};

use self::ordering::{OrderingState, BREAK, CONTINUE};
pub use self::params::all_parameters;
use self::window::Window;

mod null;
mod oracle;
mod ordering;
mod params;
mod pv;
mod qsearch;
mod see;
mod window;

pub const INVALID_MOVE: Move = Move {
    from: Square::A1,
    to: Square::A1,
    promotion: None,
};

pub(crate) struct PrivateState {
    history: OrderingState,
}

impl Default for PrivateState {
    fn default() -> Self {
        PrivateState {
            history: OrderingState::new(),
        }
    }
}

pub(crate) struct Searcher<'a> {
    pub root: &'a Board,
    pub stats: &'a Statistics,
    pub shared: &'a SharedState,
    pub node_limit: u64,
    pub abort: &'a AtomicBool,
    state: &'a mut PrivateState,
    valid: bool,
    allow_abort: bool,
    deadline: Option<Instant>,
    next_deadline_check: u64,
    rep_list: Vec<u64>,
    rep_table: [u16; 1024],
    pub root_excluded: Vec<Move>,
    pub root_allowed: Vec<Move>,
}

impl Frozenight {
    pub(super) fn with_searcher<T>(
        &mut self,
        node_limit: u64,
        abort: &AtomicBool,
        deadline: Option<Instant>,
        f: impl FnOnce(Searcher) -> T,
    ) -> T {
        self.state.history.decay();
        let mut rep_table = [0; 1024];
        for &b in &self.prehistory {
            rep_table[b as usize % 1024] += 1;
        }
        let shared = self.shared_state.read().unwrap();
        f(Searcher {
            root: &self.board,
            shared: &shared,
            abort,
            state: &mut self.state,
            stats: &self.stats,
            rep_table,
            node_limit,
            deadline,
            next_deadline_check: match deadline {
                Some(deadline) => deadline
                    .checked_duration_since(Instant::now())
                    .map_or(0, estimate_nodes_to_deadline),
                None => u64::MAX,
            },
            valid: true,
            allow_abort: false,
            rep_list: self.prehistory.clone(),
            root_excluded: vec![],
            root_allowed: vec![],
        })
    }
}

impl<'a> Searcher<'a> {
    /// Launch the search.
    ///
    /// Invariant: `self` is unchanged if this function returns `Some`. If it returns none, then
    /// calling this function again will result in a panic.
    pub fn search(&mut self, depth: i16, around: Eval) -> Option<(Eval, Move)> {
        assert!(depth > 0);
        self.allow_abort = true;
        if !self.valid {
            panic!("attempt to search using an aborted searcher");
        }

        if !self.root.generate_moves(|_| true) {
            panic!("root position (FEN: {}) has no moves", self.root);
        }

        let window = match () {
            _ if depth < 3 => Window::default(),
            _ if around.is_conclusive() => Window::default(),
            _ => Window::new(around - 500, around + 500),
        };

        let position = &Position::from_root(self.root.clone());

        let (eval, mv) = self.pv_search(position, window, depth)?;

        if window.fail_low(eval) || window.fail_high(eval) {
            self.pv_search(position, Window::default(), depth)
        } else {
            Some((eval, mv))
        }
    }

    fn visit_node(
        &mut self,
        position: &Position,
        window: Window,
        depth: i16,
        f: impl FnOnce(&mut Self) -> Option<Eval>,
    ) -> Option<Eval> {
        match position.board.status() {
            cozy_chess::GameStatus::Drawn => return Some(Eval::DRAW),
            cozy_chess::GameStatus::Won => return Some(-Eval::MATE.add_time(position.ply)),
            cozy_chess::GameStatus::Ongoing => {}
        }

        if self.allow_abort && self.abort.load(Ordering::Relaxed) {
            return None;
        }

        let result = if depth <= 0 {
            self.stats
                .selective_depth
                .fetch_max(position.ply as i16, Ordering::Relaxed);
            self.qsearch(position, window)
        } else {
            let nodes = self.stats.nodes.fetch_add(1, Ordering::Relaxed);
            if self.allow_abort {
                if nodes >= self.node_limit {
                    return None;
                }
                if let Some(deadline) = self.deadline {
                    if nodes > self.next_deadline_check {
                        let now = Instant::now();
                        if now >= deadline {
                            return None;
                        }
                        self.next_deadline_check =
                            nodes + estimate_nodes_to_deadline(deadline - now);
                    }
                }
            }
            f(self)?
        };
        if self.stopped() {
            return None;
        }

        // Sanity check that conclusive scores are valid
        #[cfg(debug_assertions)]
        if let Some(plys) = result.plys_to_conclusion() {
            debug_assert!(plys.abs() >= position.ply as i16);
        }

        Some(result)
    }

    fn search_moves(
        &mut self,
        position: &Position,
        hashmove: Option<Move>,
        mut window: Window,
        depth: i16,
        mut f: impl FnMut(&mut Searcher, usize, Move, &Position, Window) -> Option<Eval>,
    ) -> Option<(Eval, Move)> {
        let mut best_move = INVALID_MOVE;
        let mut best_score = -Eval::MATE;
        let mut raised_alpha = false;
        let mut i = 0;

        self.visit_moves(position, hashmove, |this, mv| {
            if position.ply == 0
                && (this.root_excluded.contains(&mv)
                    || (!this.root_allowed.is_empty() && !this.root_allowed.contains(&mv)))
            {
                return Some(CONTINUE);
            }
            let new_pos = position.play_move(mv, &this.shared.tt);
            i += 1;
            let i = i - 1;

            let v;
            if let Some(eval) = oracle::oracle(&new_pos.board) {
                v = eval;
            } else if this.is_repetition(&new_pos.board) {
                v = Eval::DRAW;
            } else {
                this.push_repetition(&new_pos.board);
                v = f(this, i, mv, &new_pos, window)?;
                this.pop_repetition();
            }

            if v > best_score {
                best_move = mv;
                best_score = v;
            }

            if window.fail_high(v) {
                return Some(BREAK);
            }

            if window.raise_lb(v) {
                raised_alpha = true;
            }

            Some(CONTINUE)
        })?;

        if position.ply == 0 && (!self.root_excluded.is_empty() || !self.root_allowed.is_empty()) {
            return Some((best_score, best_move));
        }
        if window.fail_high(best_score) {
            self.failed_high(position, depth, best_score, best_move);
        } else if raised_alpha {
            self.shared.tt.store(
                &position,
                TableEntry {
                    mv: best_move,
                    eval: best_score,
                    depth,
                    kind: NodeKind::Exact,
                },
            );
        } else {
            self.failed_low(position, depth, best_score, best_move);
        }

        Some((best_score, best_move))
    }

    fn failed_low(&mut self, position: &Position, depth: i16, eval: Eval, mv: Move) {
        self.shared.tt.store(
            position,
            TableEntry {
                mv,
                eval,
                depth,
                kind: NodeKind::UpperBound,
            },
        );
    }

    fn failed_high(&mut self, position: &Position, depth: i16, eval: Eval, mv: Move) {
        self.shared.tt.store(
            position,
            TableEntry {
                mv,
                eval,
                depth,
                kind: NodeKind::LowerBound,
            },
        );
        self.state.history.caused_cutoff(position, mv, depth);
    }

    fn push_repetition(&mut self, board: &Board) {
        self.rep_table[board.hash() as usize % 1024] += 1;
        self.rep_list.push(board.hash());
    }

    fn pop_repetition(&mut self) {
        let hash = self.rep_list.pop().unwrap();
        self.rep_table[hash as usize % 1024] -= 1;
    }

    fn is_repetition(&self, board: &Board) -> bool {
        if self.rep_table[board.hash() as usize % 1024] == 0 {
            return false;
        }

        self.rep_list
            .iter()
            .rev()
            .take(board.halfmove_clock() as usize)
            .skip(1)
            .any(|&b| b == board.hash())
    }

    pub fn stopped(&self) -> bool {
        self.stats.nodes.load(Ordering::Relaxed) >= self.node_limit
            || self.abort.load(Ordering::Relaxed)
            || self
                .deadline
                .map_or(false, |deadline| Instant::now() >= deadline)
    }

    pub fn extract_pv(&mut self, depth: i16) -> Vec<Move> {
        match self.shared.tt.get_move(self.root) {
            Some(mv) => self.extract_pv_from(mv, depth),
            None => vec![],
        }
    }

    pub fn extract_pv_from(&self, first: Move, depth: i16) -> Vec<Move> {
        let mut board = self.root.clone();
        let mut pv = vec![];
        let mut next = Some(first);
        let mut hashes = vec![board.hash()];
        while let Some(mv) = next {
            if !board.is_legal(mv) {
                break;
            }
            pv.push(mv);
            board.play(mv);
            if pv.len() >= depth.max(1) as usize || hashes.contains(&board.hash()) {
                break;
            }
            hashes.push(board.hash());
            next = self.shared.tt.get_move(&board);
        }
        pv
    }
}

fn estimate_nodes_to_deadline(d: Duration) -> u64 {
    // assume we get at least 1 mnps (very conservative)
    1000 * d.as_millis().min(1) as u64
}
