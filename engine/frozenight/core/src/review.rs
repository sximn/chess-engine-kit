//! MultiPV is searched at the same root and completed depth, excluding earlier root moves.
use crate::{clock::Instant, position::Position, Eval, Frozenight, SearchInfo};
use cozy_chess::Move;
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

#[derive(Clone, Debug)]
pub struct ReviewIteration {
    pub lines: Vec<SearchInfo>,
    pub depth: i16,
    pub nodes: u64,
}
pub struct ReviewSearch {
    pub iteration: Option<ReviewIteration>,
    pub nodes: u64,
    pub reason: &'static str,
}

impl Frozenight {
    pub fn static_eval(&self) -> Eval {
        Position::from_root(self.board.clone()).static_eval()
    }

    pub fn review(
        &mut self,
        depth: i16,
        nodes: u64,
        time: Option<Duration>,
        multi_pv: usize,
        allowed: Vec<Move>,
        mut emit: impl FnMut(&ReviewIteration),
    ) -> ReviewSearch {
        self.stats.clear();
        let deadline = time.map(|t| Instant::now() + t);
        let abort = AtomicBool::new(false);
        let mut count = 0;
        self.board.generate_moves(|mvs| {
            count += mvs
                .into_iter()
                .filter(|m| allowed.is_empty() || allowed.contains(m))
                .count();
            false
        });
        let wanted = multi_pv.min(count);
        if wanted == 0 {
            return ReviewSearch {
                iteration: None,
                nodes: 0,
                reason: "terminal",
            };
        }
        let mut completed = None;
        self.with_searcher(nodes, &abort, deadline, |mut searcher| {
            searcher.root_allowed = allowed;
            let mut around = vec![Eval::DRAW; wanted];
            'iteration: for d in 1..=depth {
                searcher.root_excluded.clear();
                let mut lines = vec![];
                for rank in 0..wanted {
                    if searcher.stopped() {
                        break 'iteration;
                    }
                    let (eval, mv) = match searcher.search(d, around[rank]) {
                        Some(v) => v,
                        None => break 'iteration,
                    };
                    if searcher.stopped() {
                        break 'iteration;
                    }
                    around[rank] = eval;
                    let pv = searcher.extract_pv_from(mv, d);
                    lines.push(SearchInfo {
                        eval,
                        nodes: searcher.stats.nodes.load(Ordering::Relaxed),
                        depth: d,
                        selective_depth: searcher.stats.selective_depth.load(Ordering::Relaxed),
                        hashfull: searcher.shared.tt.hashfull(),
                        best_move: mv,
                        pv,
                    });
                    searcher.root_excluded.push(mv);
                }
                // Search noise may change the ordering; publish one atomic completed iteration.
                lines.sort_by(|a, b| b.eval.cmp(&a.eval));
                let result = ReviewIteration {
                    lines,
                    depth: d,
                    nodes: searcher.stats.nodes.load(Ordering::Relaxed),
                };
                emit(&result);
                completed = Some(result);
            }
        });
        let total = self.stats.nodes.load(Ordering::Relaxed);
        let reason = if deadline.map_or(false, |d| Instant::now() >= d) {
            "time"
        } else if total >= nodes {
            "nodes"
        } else {
            "depth"
        };
        ReviewSearch {
            iteration: completed,
            nodes: total,
            reason,
        }
    }
}
