# Curated C Libraries

These header-only teaching libraries ship with Boardroom. They are project-provided extensions, not ISO C standard-library headers. Include them in a full C11 program; the runner supplies their include directory. Open **Libraries** in the side panel to inspect the exact header compiled by Docker or load a runnable example.

All containers store `int` values. Initialize before first use, pass valid pointers to initialized containers, and call the corresponding free function when finished. Free resets a container so it can be reused or freed again. Do not make shallow copies of owning containers: copies would share allocations and could double-free them.

## Stack — `<stack.h>`

`Stack` uses a growing contiguous buffer and last-in, first-out order.

| Function | Behavior |
| --- | --- |
| `stack_init(&s)` | Initialize an empty stack |
| `stack_push(&s, value)` | Append a value; grow the buffer when needed |
| `stack_pop(&s)` | Remove and return the top value; reject an empty stack |
| `stack_empty(&s)` | Return nonzero when empty |
| `stack_free(&s)` | Release the buffer and reset the stack |

Push is amortized O(1); pop and empty checks are O(1). Buffer growth is logged to stderr for teaching. The **Under the abstraction** lesson intentionally pops an empty stack; add a push before the pop to fix it.

## Linked list — `<linked_list.h>`

`LinkedList` has `head`, `tail`, and `size`. Each `ListNode` has an integer `value` and a `next` pointer. Indices start at zero.

| Function | Behavior |
| --- | --- |
| `list_init(&list)` | Initialize an empty list |
| `list_push_front(&list, value)` | Insert at the head, O(1) |
| `list_push_back(&list, value)` | Insert at the tail, O(1) |
| `list_insert(&list, index, value)` | Insert before an index; `index == size` appends |
| `list_erase(&list, index)` | Remove and return the indexed value |
| `list_front(&list)` | Read the head value without removing it |
| `list_pop_front(&list)` | Remove and return the head value, O(1) |
| `list_find(&list, value)` | Return the first matching `const ListNode *`, or `NULL` |
| `list_size(&list)` / `list_empty(&list)` | Read the count or test emptiness, O(1) |
| `list_free(&list)` | Release every remaining node and reset the list |

Search and middle-index operations are O(n). The list owns its nodes. Pointers returned by `list_find` become invalid when that node is removed or the list is freed.

```c
#include <stdio.h>
#include <linked_list.h>

int main(void) {
    LinkedList list;
    list_init(&list);
    list_push_back(&list, 10);
    list_push_back(&list, 30);
    list_insert(&list, 1, 20);
    for (const ListNode *node = list.head; node; node = node->next) {
        printf("%d\n", node->value);
    }
    list_free(&list);
    return 0;
}
```

## Queue — `<queue.h>`

`Queue` uses a growing circular buffer and first-in, first-out order. Pop advances the head instead of shifting the array. Growth copies the logical sequence into a larger buffer, preserving order after wraparound.

| Function | Behavior |
| --- | --- |
| `queue_init(&q)` | Initialize an empty queue |
| `queue_push(&q, value)` | Enqueue at the back; amortized O(1) |
| `queue_front(&q)` | Read the oldest value without removing it, O(1) |
| `queue_pop(&q)` | Remove and return the oldest value, O(1) |
| `queue_size(&q)` / `queue_empty(&q)` | Read the count or test emptiness, O(1) |
| `queue_free(&q)` | Release the buffer and reset the queue |

```c
#include <stdio.h>
#include <queue.h>

int main(void) {
    Queue q;
    queue_init(&q);
    queue_push(&q, 10);
    queue_push(&q, 20);
    while (!queue_empty(&q)) printf("%d\n", queue_pop(&q));
    queue_free(&q);
    return 0;
}
```

## Binary search — `<search.h>`

These algorithms require an **ascending sorted integer array** and a valid element count. They do not sort the array or scan it to check ordering. Each search uses O(log n) time and O(1) additional space. An empty array may use `NULL` and length zero.

| Function | Result |
| --- | --- |
| `binary_search(values, length, target)` | `ptrdiff_t`: first matching index, or `-1` |
| `lower_bound(values, length, target)` | `size_t`: first position whose value is at least the target, or `length` |
| `upper_bound(values, length, target)` | `size_t`: first position whose value is greater than the target, or `length` |

The half-open range `[lower_bound(...), upper_bound(...))` contains all occurrences of a target. Print search indices with `%td` and bound positions with `%zu`.

```c
#include <stdio.h>
#include <search.h>

int main(void) {
    int values[] = {1, 2, 4, 4, 4, 7};
    size_t count = sizeof values / sizeof values[0];
    printf("First 4: %td\n", binary_search(values, count, 4));
    printf("Equal range: [%zu, %zu)\n",
        lower_bound(values, count, 4), upper_bound(values, count, 4));
    printf("Missing 9: %td\n", binary_search(values, count, 9));
    return 0;
}
```

## Contracts and verification

Empty pop/front operations, invalid list indices, allocation failures, and detected capacity/index overflow report a contract error. Public operation macros pass `__LINE__`, so the UI highlights the calling board line. A nonempty search with a null pointer also fails its contract. Arbitrary invalid pointers or corrupted container fields are outside these contracts; runtime sanitizers provide additional checks.

`board_contract.h` is an internal helper included by the new headers; it is not exposed as a public include or API endpoint. Only the named public library files are served by `/api/library/<name>`.

Run `npm test` for trusted GCC fixtures and `npm run test:docker` for the container boundary, with leak detection enabled. Tests cover empty/singleton states, duplicate values, list endpoints, queue wraparound and growth, binary-search boundaries, cleanup, and caller-line diagnostics. Starter lessons also run through the browser suite.
