use std::io::{self, BufRead};
fn main() {
    for line in io::stdin().lock().lines() {
        let input = line.unwrap();
        println!("{}", upapawn_engine::analyze(&input, |_| {}));
    }
}
