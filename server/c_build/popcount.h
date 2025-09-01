#pragma once
/*
 * popcount.h - fast 64-bit population count helper
 *
 * Provides a single function:
 *     int popcount64_u64(unsigned long long x);
 *
 * - On GCC/Clang, uses __builtin_popcountll (emits POPCNT when available).
 * - On MSVC, uses __popcnt64 from <intrin.h>.
 * - Otherwise falls back to a portable bit-twiddling loop.
 *
 * Build tips:
 *   GCC/Clang: compile with -O3 -march=native (or at least -mpopcnt)
 *   MSVC: /O2 is sufficient.
 */

#if defined(_MSC_VER)
  #include <intrin.h>
  static __forceinline int popcount64_u64(unsigned long long x) {
    return (int)__popcnt64(x);
  }

#elif defined(__GNUC__) || defined(__clang__)
  static inline int popcount64_u64(unsigned long long x) {
    return __builtin_popcountll(x);
  }

#else
  // Portable fallback: Kernighan’s bit trick
  static inline int popcount64_u64(unsigned long long x) {
    int c = 0;
    while (x) { x &= (x - 1); c++; }
    return c;
  }
#endif
