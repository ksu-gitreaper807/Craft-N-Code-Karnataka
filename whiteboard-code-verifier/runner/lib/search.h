#ifndef BOARD_SEARCH_H
#define BOARD_SEARCH_H

#include <stddef.h>
#include <stdint.h>
#include "board_contract.h"

/* Ascending sorted integer arrays. Empty arrays may use NULL.
 * Sorting is the caller's precondition; it is not checked in O(log n) searches.
 */
static inline size_t lower_bound_(const int *values, size_t length, int target, int line) {
    if (length && !values) board_contract_fail("search", "nonempty array requires a valid pointer", line);
    size_t left = 0, right = length;
    while (left < right) {
        size_t middle = left + (right - left) / 2;
        if (values[middle] < target) left = middle + 1;
        else right = middle;
    }
    return left;
}

static inline size_t upper_bound_(const int *values, size_t length, int target, int line) {
    if (length && !values) board_contract_fail("search", "nonempty array requires a valid pointer", line);
    size_t left = 0, right = length;
    while (left < right) {
        size_t middle = left + (right - left) / 2;
        if (values[middle] <= target) left = middle + 1;
        else right = middle;
    }
    return left;
}

/* First matching index, or -1 if absent. */
static inline ptrdiff_t binary_search_(const int *values, size_t length, int target, int line) {
    if (length > (size_t)PTRDIFF_MAX) board_contract_fail("search", "array length exceeds index range", line);
    size_t index = lower_bound_(values, length, target, line);
    return index < length && values[index] == target ? (ptrdiff_t)index : -1;
}

#ifdef __cplusplus
// Functions avoid collisions with std::lower_bound and std::binary_search.
// GCC evaluates this default argument at the caller, preserving teaching lines.
static inline size_t lower_bound(const int *values, size_t length, int target, int line = __builtin_LINE()) {
    return lower_bound_(values, length, target, line);
}
static inline size_t upper_bound(const int *values, size_t length, int target, int line = __builtin_LINE()) {
    return upper_bound_(values, length, target, line);
}
static inline ptrdiff_t binary_search(const int *values, size_t length, int target, int line = __builtin_LINE()) {
    return binary_search_(values, length, target, line);
}
#else
#define lower_bound(values, length, target) lower_bound_((values), (length), (target), __LINE__)
#define upper_bound(values, length, target) upper_bound_((values), (length), (target), __LINE__)
#define binary_search(values, length, target) binary_search_((values), (length), (target), __LINE__)

#endif

#endif
