#ifndef BOARD_QUEUE_H
#define BOARD_QUEUE_H

#include <stddef.h>
#include <stdint.h>
#include "board_contract.h"

/* Growing circular integer queue. Initialize once; release with queue_free. */
typedef struct {
    int *data;
    size_t head;
    size_t size;
    size_t capacity;
} Queue;

static inline void queue_init(Queue *queue) {
    queue->data = NULL;
    queue->head = queue->size = queue->capacity = 0;
}

static inline size_t queue_size(const Queue *queue) { return queue->size; }
static inline int queue_empty(const Queue *queue) { return queue->size == 0; }

static inline void queue_push_(Queue *queue, int value, int line) {
    if (queue->size == queue->capacity) {
        if (queue->capacity > SIZE_MAX / 2 / sizeof(int)) {
            board_contract_fail("queue", "capacity exceeds addressable storage", line);
        }
        size_t capacity = queue->capacity ? queue->capacity * 2 : 4;
        int *data = (int *)malloc(capacity * sizeof *data);
        if (!data) board_contract_fail("queue", "allocation failed", line);
        for (size_t i = 0; i < queue->size; i++) {
            data[i] = queue->data[(queue->head + i) % queue->capacity];
        }
        free(queue->data);
        queue->data = data;
        queue->capacity = capacity;
        queue->head = 0;
    }
    queue->data[(queue->head + queue->size) % queue->capacity] = value;
    queue->size++;
}

static inline int queue_front_(const Queue *queue, int line) {
    if (!queue->size) board_contract_fail("queue", "front on empty queue", line);
    return queue->data[queue->head];
}

static inline int queue_pop_(Queue *queue, int line) {
    if (!queue->size) board_contract_fail("queue", "pop on empty queue", line);
    int value = queue->data[queue->head];
    queue->head = (queue->head + 1) % queue->capacity;
    if (!--queue->size) queue->head = 0;
    return value;
}

static inline void queue_free(Queue *queue) {
    free(queue->data);
    queue_init(queue);
}

#define queue_push(queue, value) queue_push_((queue), (value), __LINE__)
#define queue_front(queue) queue_front_((queue), __LINE__)
#define queue_pop(queue) queue_pop_((queue), __LINE__)

#endif
