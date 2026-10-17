#include <assert.h>
#include <limits.h>
#include <linked_list.h>
#include <queue.h>
#include <search.h>
#include <stack.h>

int main(void) {
    LinkedList list;
    list_init(&list);
    assert(list_empty(&list) && list_size(&list) == 0);
    list_insert(&list, 0, 20);
    list_push_front(&list, 10);
    list_push_back(&list, 40);
    list_insert(&list, 2, 30);
    list_insert(&list, 4, 50);
    assert(list_size(&list) == 5 && list_front(&list) == 10);
    assert(list_find(&list, 30)->value == 30 && !list_find(&list, 99));
    assert(list_erase(&list, 2) == 30);
    assert(list_erase(&list, 3) == 50 && list.tail->value == 40);
    assert(list_erase(&list, 0) == 10);
    assert(list_pop_front(&list) == 20);
    assert(list_pop_front(&list) == 40);
    assert(list_empty(&list) && !list.head && !list.tail);
    list_push_back(&list, 7);
    list_push_back(&list, 7);
    assert(list_find(&list, 7) == list.head);
    list_free(&list);
    list_free(&list);
    assert(list_empty(&list));

    Queue queue;
    queue_init(&queue);
    assert(queue_empty(&queue) && queue_size(&queue) == 0);
    /* Move head away from zero, wrap the buffer, then force growth. */
    for (int i = 0; i < 4; i++) queue_push(&queue, i);
    assert(queue_pop(&queue) == 0 && queue_pop(&queue) == 1);
    for (int i = 4; i < 200; i++) queue_push(&queue, i);
    assert(queue_front(&queue) == 2 && queue_size(&queue) == 198);
    for (int i = 2; i < 200; i++) assert(queue_pop(&queue) == i);
    assert(queue_empty(&queue));
    queue_push(&queue, -42);
    assert(queue_pop(&queue) == -42);
    queue_free(&queue);
    queue_free(&queue);
    assert(queue_empty(&queue) && queue.data == NULL);

    int values[] = {INT_MIN, -3, 0, 4, 4, 4, 9, INT_MAX};
    assert(binary_search(values, 8, 4) == 3);
    assert(lower_bound(values, 8, 4) == 3 && upper_bound(values, 8, 4) == 6);
    assert(binary_search(values, 8, INT_MIN) == 0);
    assert(binary_search(values, 8, INT_MAX) == 7);
    assert(binary_search(values, 8, 2) == -1);
    assert(lower_bound(values, 8, 2) == 3);
    assert(upper_bound(values, 8, INT_MAX) == 8);
    assert(binary_search(NULL, 0, 4) == -1);
    assert(lower_bound(NULL, 0, 4) == 0 && upper_bound(NULL, 0, 4) == 0);
    int single[] = {7};
    assert(binary_search(single, 1, 7) == 0 && binary_search(single, 1, 8) == -1);

    Stack stack;
    stack_init(&stack);
    stack_push(&stack, 42);
    assert(stack_pop(&stack) == 42);
    stack_free(&stack);
    return 0;
}
