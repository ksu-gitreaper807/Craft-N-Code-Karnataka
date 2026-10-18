#ifndef BOARD_STACK_H
#define BOARD_STACK_H

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

/* Initialize before use. The caller owns the buffer and must call stack_free. */
typedef struct {
    int *data;
    size_t len;
    size_t cap;
} Stack;

static inline void stack_init(Stack *s) {
    s->data = NULL;
    s->len = s->cap = 0;
}

static inline void stack_contract(const char *message, int line) {
    fprintf(stderr, "[stack] CONTRACT: %s, board line %d\n", message, line);
    exit(2);
}

static inline void stack_push_(Stack *s, int value, int line) {
    if (s->len == s->cap) {
        if (s->cap > SIZE_MAX / 2 / sizeof(int)) {
            stack_contract("capacity exceeds addressable storage", line);
        }
        size_t next = s->cap ? s->cap * 2 : 4;
        int *data = (int *)realloc(s->data, next * sizeof *data);
        if (!data) stack_contract("allocation failed", line);
        fprintf(stderr, "[stack] grow %zu -> %zu ints\n", s->cap, next);
        s->data = data;
        s->cap = next;
    }
    s->data[s->len++] = value;
}

static inline int stack_pop_(Stack *s, int line) {
    if (!s->len) stack_contract("pop on empty stack", line);
    return s->data[--s->len];
}

static inline int stack_empty(const Stack *s) { return s->len == 0; }

static inline void stack_free(Stack *s) {
    free(s->data);
    s->data = NULL;
    s->len = s->cap = 0;
}

#define stack_push(s, value) stack_push_((s), (value), __LINE__)
#define stack_pop(s) stack_pop_((s), __LINE__)

#endif
