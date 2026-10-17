export const libraries = [
  { file: 'stack.h', title: 'Stack', lessonId: 'stack',
    description: 'A growing integer stack: last in, first out. Initialize before use and release with stack_free.',
    methods: 'stack_init · stack_push · stack_pop · stack_empty · stack_free' },
  { file: 'linked_list.h', title: 'Linked list', lessonId: 'linked-list',
    description: 'A singly linked integer list with head, tail, and size. Nodes belong to the list; release with list_free.',
    methods: 'list_init · list_push_front · list_push_back · list_insert · list_erase · list_front · list_pop_front · list_find · list_size · list_empty · list_free' },
  { file: 'queue.h', title: 'Queue', lessonId: 'queue',
    description: 'A growing circular integer queue: first in, first out. Release its buffer with queue_free.',
    methods: 'queue_init · queue_push · queue_front · queue_pop · queue_size · queue_empty · queue_free' },
  { file: 'search.h', title: 'Binary search', lessonId: 'search',
    description: 'O(log n) searches on an ascending sorted integer array. binary_search returns the first matching index or -1; bounds return insertion positions.',
    methods: 'binary_search · lower_bound · upper_bound' },
];
