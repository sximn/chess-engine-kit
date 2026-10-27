use cozy_chess::{Board, Color, File, GameStatus, Move, Piece, Square};
use frozenight::{Frozenight, ReviewIteration};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{cell::RefCell, collections::HashMap, time::Duration};

// The wasm allocator reports exhaustion through the worker before Rust aborts.
// The throwing import unwinds to JS; supervision then discards that worker.
#[cfg(target_arch = "wasm32")]
mod allocation {
    use std::alloc::{GlobalAlloc, Layout, System};
    unsafe extern "C" {
        fn out_of_memory();
    }
    struct CheckedAllocator;
    unsafe impl GlobalAlloc for CheckedAllocator {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            let p = System.alloc(layout);
            if p.is_null() {
                out_of_memory();
            }
            p
        }
        unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
            let p = System.alloc_zeroed(layout);
            if p.is_null() {
                out_of_memory();
            }
            p
        }
        unsafe fn realloc(&self, p: *mut u8, layout: Layout, size: usize) -> *mut u8 {
            let p = System.realloc(p, layout, size);
            if p.is_null() {
                out_of_memory();
            }
            p
        }
        unsafe fn dealloc(&self, p: *mut u8, layout: Layout) {
            System.dealloc(p, layout)
        }
    }
    #[global_allocator]
    static ALLOCATOR: CheckedAllocator = CheckedAllocator;
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    root_fen: String,
    moves_uci: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    max_nodes: u64,
    max_time_ms: Option<u64>,
    max_depth: Option<i16>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    position: Position,
    limits: Limits,
    multi_pv: usize,
    #[serde(default = "default_hash")]
    hash_mib: usize,
    #[serde(default)]
    root_moves: Vec<String>,
    #[serde(default)]
    operation: String,
}
fn default_hash() -> usize {
    32
}

pub fn uci(board: &Board, mv: Move) -> String {
    let mut to = mv.to;
    if board.piece_on(mv.from) == Some(Piece::King)
        && board.color_on(to) == Some(board.side_to_move())
    {
        to = Square::new(
            if to.file() > mv.from.file() {
                File::G
            } else {
                File::C
            },
            mv.from.rank(),
        );
    }
    format!(
        "{}{}{}",
        mv.from,
        to,
        mv.promotion.map(|p| p.to_string()).unwrap_or_default()
    )
}

fn parse_move(board: &Board, text: &str) -> Result<Move, String> {
    let mut found = None;
    board.generate_moves(|mvs| {
        for mv in mvs {
            if uci(board, mv) == text {
                found = Some(mv);
            }
        }
        found.is_some()
    });
    found.ok_or_else(|| "INVALID_POSITION".into())
}

fn insufficient(board: &Board) -> bool {
    if !(board.pieces(Piece::Pawn) | board.pieces(Piece::Rook) | board.pieces(Piece::Queen))
        .is_empty()
    {
        return false;
    }
    if board.occupied().len() <= 3 {
        return true;
    }
    if !board.pieces(Piece::Knight).is_empty() {
        return false;
    }
    let mut color = None;
    for sq in board.pieces(Piece::Bishop) {
        let parity = (sq.file() as usize + sq.rank() as usize) % 2;
        if color.map_or(false, |c| c != parity) {
            return false;
        }
        color = Some(parity);
    }
    true
}

fn lines(root: &Board, iteration: &ReviewIteration) -> Vec<Value> {
    let sign = if root.side_to_move() == Color::White {
        1
    } else {
        -1
    };
    iteration.lines.iter().enumerate().map(|(index, line)| {
        let mut board = root.clone();
        let pv: Vec<_> = line.pv.iter().map(|&mv| { let s = uci(&board, mv); board.play(mv); s }).collect();
        // Frozenight's finite integer units are 1/5 of a displayed centipawn.
        let score = match line.eval.plys_to_conclusion() {
            Some(plies) => json!({"perspective":"white","kind":"mate","value":sign * plies as i32,"unit":"plies","bound":"exact"}),
            None => json!({"perspective":"white","kind":"cp","value":sign * (line.eval.raw() as i32 / 5),"bound":"exact"}),
        };
        json!({"rank":index+1,"rootMove":uci(root,line.best_move),"pv":pv,"score":score})
    }).collect()
}

pub fn analyze(input: &str, mut progress: impl FnMut(&Value)) -> Value {
    match execute(input, &mut progress) {
        Ok(result) => result,
        Err(code) => json!({"error":code}),
    }
}

fn execute(input: &str, progress: &mut impl FnMut(&Value)) -> Result<Value, String> {
    let request: Request = serde_json::from_str(input).map_err(|_| "INVALID_OPTIONS")?;
    if !(1..=3).contains(&request.multi_pv)
        || !(16..=64).contains(&request.hash_mib)
        || !(1_000..=10_000_000).contains(&request.limits.max_nodes)
        || !(1..=40).contains(&request.limits.max_depth.unwrap_or(40))
        || request
            .limits
            .max_time_ms
            .map_or(false, |t| !(10..=30_000).contains(&t))
        || request.position.moves_uci.len() > 2000
        || request.root_moves.len() > 256
    {
        return Err("INVALID_OPTIONS".into());
    }
    let root: Board = request
        .position
        .root_fen
        .parse()
        .map_err(|_| "INVALID_POSITION")?;
    let mut board = root.clone();
    let mut moves = vec![];
    let mut repetitions = HashMap::new();
    repetitions.insert(board.hash(), 1usize);
    for text in request.position.moves_uci {
        let mv = parse_move(&board, &text)?;
        board.play(mv);
        *repetitions.entry(board.hash()).or_insert(0) += 1;
        moves.push(mv);
    }
    let mut allowed = vec![];
    for text in request.root_moves {
        let mv = parse_move(&board, &text)?;
        if !allowed.contains(&mv) {
            allowed.push(mv);
        }
    }
    if request.operation == "perft" {
        let depth = request.limits.max_depth.unwrap_or(1);
        if depth > 5 {
            return Err("INVALID_OPTIONS".into());
        }
        return Ok(json!({"nodes":perft(&board, depth as u8)}));
    }
    let outcome = match board.status() {
        GameStatus::Won => Some("checkmate"),
        GameStatus::Drawn if board.halfmove_clock() >= 100 => Some("fifty-move"),
        GameStatus::Drawn => Some("stalemate"),
        _ if repetitions.get(&board.hash()).copied().unwrap_or(0) >= 3 => Some("repetition"),
        _ if insufficient(&board) => Some("insufficient-material"),
        _ => None,
    };
    if let Some(outcome) = outcome {
        let score = if outcome == "checkmate" {
            json!({"perspective":"white","kind":"mate","value":0,"unit":"plies","bound":"exact"})
        } else {
            json!({"perspective":"white","kind":"cp","value":0,"bound":"exact"})
        };
        return Ok(
            json!({"lines":[],"depth":0,"nodes":0,"iterationNodes":0,"completedIteration":true,"reason":"terminal","outcome":outcome,"terminalScore":score,"winner":if outcome=="checkmate" {Some(if board.side_to_move()==Color::White {"black"} else {"white"})} else {None}}),
        );
    }
    // Cold hash and ordering per accepted request makes native/WASM results reproducible.
    let mut engine = Frozenight::new(request.hash_mib);
    engine.set_position(root, moves.into_iter());
    if request.operation == "eval" {
        return Ok(json!({"raw":engine.static_eval().raw()}));
    }
    let result = engine.review(request.limits.max_depth.unwrap_or(40), request.limits.max_nodes,
        request.limits.max_time_ms.map(Duration::from_millis), request.multi_pv, allowed,
        |iteration| progress(&json!({"lines":lines(&board, iteration),"depth":iteration.depth,"nodes":iteration.nodes,"iterationNodes":iteration.nodes,"completedIteration":true})));
    Ok(match result.iteration {
        Some(iteration) => {
            json!({"lines":lines(&board,&iteration),"depth":iteration.depth,"nodes":result.nodes,"iterationNodes":iteration.nodes,"completedIteration":true,"reason":result.reason})
        }
        None => {
            json!({"lines":[],"depth":0,"nodes":result.nodes,"iterationNodes":0,"completedIteration":false,"reason":result.reason})
        }
    })
}

pub fn perft(board: &Board, depth: u8) -> u64 {
    if depth == 0 {
        return 1;
    }
    let mut nodes = 0;
    board.generate_moves(|mvs| {
        for mv in mvs {
            let mut next = board.clone();
            next.play(mv);
            nodes += perft(&next, depth - 1);
        }
        false
    });
    nodes
}

thread_local! { static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) }; }
#[cfg(target_arch = "wasm32")]
unsafe extern "C" {
    fn emit_progress(ptr: *const u8, len: usize);
}
#[unsafe(no_mangle)]
pub extern "C" fn engine_alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_free(ptr: *mut u8, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_run(ptr: *const u8, len: usize) {
    let result = if len > 65536 {
        json!({"error":"INVALID_OPTIONS"})
    } else {
        match std::str::from_utf8(std::slice::from_raw_parts(ptr, len)) {
            Ok(input) => analyze(input, |event| {
                #[cfg(target_arch = "wasm32")]
                {
                    let bytes = event.to_string().into_bytes();
                    emit_progress(bytes.as_ptr(), bytes.len());
                }
                #[cfg(not(target_arch = "wasm32"))]
                let _ = event;
            }),
            Err(_) => json!({"error":"INVALID_OPTIONS"}),
        }
    };
    OUTPUT.with(|out| *out.borrow_mut() = result.to_string().into_bytes());
}
#[unsafe(no_mangle)]
pub extern "C" fn engine_result_ptr() -> *const u8 {
    OUTPUT.with(|out| out.borrow().as_ptr())
}
#[unsafe(no_mangle)]
pub extern "C" fn engine_result_len() -> usize {
    OUTPUT.with(|out| out.borrow().len())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reference_perft() {
        assert_eq!(perft(&Board::default(), 4), 197281);
    }
    #[test]
    fn castle_notation() {
        let b: Board = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1".parse().unwrap();
        assert_eq!(uci(&b, parse_move(&b, "e1g1").unwrap()), "e1g1");
    }
}
