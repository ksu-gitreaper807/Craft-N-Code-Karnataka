#ifndef BOARD_LINKED_LIST_H
#define BOARD_LINKED_LIST_H

#include <stddef.h>
#include <ctype.h>
#include <errno.h>
#include <limits.h>
#include "board_contract.h"

/* Singly linked integer list. Initialize once; release nodes with list_free. */
typedef struct ListNode {
    int value;
    struct ListNode *next;
} ListNode;

typedef struct {
    ListNode *head;
    ListNode *tail;
    size_t size;
} LinkedList;

static inline void list_init(LinkedList *list) {
    list->head = list->tail = NULL;
    list->size = 0;
}

static inline size_t list_size(const LinkedList *list) { return list->size; }
static inline int list_empty(const LinkedList *list) { return list->size == 0; }

static inline ListNode *list_node_(int value, ListNode *next, int line) {
    ListNode *node = (ListNode *)malloc(sizeof *node);
    if (!node) board_contract_fail("linked_list", "allocation failed", line);
    node->value = value;
    node->next = next;
    return node;
}

static inline void list_push_front_(LinkedList *list, int value, int line) {
    list->head = list_node_(value, list->head, line);
    if (!list->tail) list->tail = list->head;
    list->size++;
}

static inline void list_push_back_(LinkedList *list, int value, int line) {
    ListNode *node = list_node_(value, NULL, line);
    if (list->tail) list->tail->next = node;
    else list->head = node;
    list->tail = node;
    list->size++;
}

static inline int list_front_(const LinkedList *list, int line) {
    if (!list->head) board_contract_fail("linked_list", "front on empty list", line);
    return list->head->value;
}

static inline int list_pop_front_(LinkedList *list, int line) {
    if (!list->head) board_contract_fail("linked_list", "pop on empty list", line);
    ListNode *node = list->head;
    int value = node->value;
    list->head = node->next;
    free(node);
    if (!--list->size) list->tail = NULL;
    return value;
}

/* Insert accepts indices 0..size; erase accepts 0..size-1. */
static inline void list_insert_(LinkedList *list, size_t index, int value, int line) {
    if (index > list->size) board_contract_fail("linked_list", "insert index out of bounds", line);
    if (!index) { list_push_front_(list, value, line); return; }
    if (index == list->size) { list_push_back_(list, value, line); return; }
    ListNode *previous = list->head;
    for (size_t i = 1; i < index; i++) previous = previous->next;
    previous->next = list_node_(value, previous->next, line);
    list->size++;
}

static inline int list_erase_(LinkedList *list, size_t index, int line) {
    if (index >= list->size) board_contract_fail("linked_list", "erase index out of bounds", line);
    if (!index) return list_pop_front_(list, line);
    ListNode *previous = list->head;
    for (size_t i = 1; i < index; i++) previous = previous->next;
    ListNode *node = previous->next;
    int value = node->value;
    previous->next = node->next;
    if (list->tail == node) list->tail = previous;
    free(node);
    list->size--;
    return value;
}

/* Return the first matching node, or NULL. The list retains ownership. */
static inline const ListNode *list_find(const LinkedList *list, int value) {
    for (const ListNode *node = list->head; node; node = node->next) {
        if (node->value == value) return node;
    }
    return NULL;
}

static inline void list_free(LinkedList *list) {
    ListNode *node = list->head;
    while (node) {
        ListNode *next = node->next;
        free(node);
        node = next;
    }
    list_init(list);
}

/* Parse decimal integers separated by ->. Initialize the destination first.
 * Success replaces its nodes; invalid input leaves the destination unchanged.
 * Returns 1 on success, 0 on malformed/out-of-range input. Empty input is invalid.
 */
static inline int list_from_arrows_(LinkedList *list, const char *drawing, int line) {
    if (!list || !drawing) return 0;
    LinkedList parsed;
    list_init(&parsed);
    const char *cursor = drawing;
    for (;;) {
        while (isspace((unsigned char)*cursor)) cursor++;
        const char *digits = cursor;
        if (*digits == '+' || *digits == '-') digits++;
        if (!isdigit((unsigned char)*digits)) { list_free(&parsed); return 0; }
        errno = 0;
        char *end;
        long value = strtol(cursor, &end, 10);
        if (errno == ERANGE || value < INT_MIN || value > INT_MAX) { list_free(&parsed); return 0; }
        list_push_back_(&parsed, (int)value, line);
        cursor = end;
        while (isspace((unsigned char)*cursor)) cursor++;
        if (!*cursor) break;
        if (cursor[0] != '-' || cursor[1] != '>') { list_free(&parsed); return 0; }
        cursor += 2;
    }
    list_free(list);
    *list = parsed;
    return 1;
}

#define list_from_arrows(list, drawing) list_from_arrows_((list), (drawing), __LINE__)

#define list_push_front(list, value) list_push_front_((list), (value), __LINE__)
#define list_push_back(list, value) list_push_back_((list), (value), __LINE__)
#define list_front(list) list_front_((list), __LINE__)
#define list_pop_front(list) list_pop_front_((list), __LINE__)
#define list_insert(list, index, value) list_insert_((list), (index), (value), __LINE__)
#define list_erase(list, index) list_erase_((list), (index), __LINE__)

#endif
