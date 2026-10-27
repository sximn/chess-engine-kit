//! Browser monotonic time supplied by the worker. Native reference uses std's clock.
#[cfg(not(target_arch = "wasm32"))]
pub use std::time::Instant;

#[cfg(target_arch = "wasm32")]
mod browser {
    use std::{
        ops::{Add, Sub},
        time::Duration,
    };
    unsafe extern "C" {
        fn now_ms() -> f64;
    }
    #[derive(Clone, Copy, Debug, PartialEq, PartialOrd)]
    pub struct Instant(f64);
    impl Instant {
        pub fn now() -> Self {
            Self(unsafe { now_ms() })
        }
        pub fn checked_duration_since(&self, other: Self) -> Option<Duration> {
            if self.0 < other.0 {
                None
            } else {
                Some(*self - other)
            }
        }
    }
    impl Add<Duration> for Instant {
        type Output = Self;
        fn add(self, d: Duration) -> Self {
            Self(self.0 + d.as_secs_f64() * 1000.0)
        }
    }
    impl Sub for Instant {
        type Output = Duration;
        fn sub(self, other: Self) -> Duration {
            Duration::from_secs_f64(((self.0 - other.0) / 1000.0).max(0.0))
        }
    }
}
#[cfg(target_arch = "wasm32")]
pub use browser::Instant;
