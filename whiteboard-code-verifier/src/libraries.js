export const libraries = [
  { file: 'stack.h', title: 'Stack', lessonId: 'stack',
    description: 'A growing integer stack: last in, first out. Initialize before use and release with stack_free.',
    methods: 'stack_init · stack_push · stack_pop · stack_empty · stack_free' },
  { file: 'linked_list.h', title: 'Linked list', lessonId: 'linked-list',
    description: 'A singly linked integer list with head, tail, and size. Build from an arrow chain such as 1->3->4->5 with list_from_arrows. Nodes belong to the list; release with list_free.',
    methods: 'list_init · list_from_arrows · list_push_front · list_push_back · list_insert · list_erase · list_front · list_pop_front · list_find · list_size · list_empty · list_free' },
  { file: 'queue.h', title: 'Queue', lessonId: 'queue',
    description: 'A growing circular integer queue: first in, first out. Release its buffer with queue_free.',
    methods: 'queue_init · queue_push · queue_front · queue_pop · queue_size · queue_empty · queue_free' },
  { file: 'search.h', title: 'Binary search', lessonId: 'search',
    description: 'O(log n) searches on an ascending sorted integer array. binary_search returns the first matching index or -1; bounds return insertion positions.',
    methods: 'binary_search · lower_bound · upper_bound' },
];

// STL entries are examples, not vendored headers or archive dependencies.
export const standardLibraries = [
  { file: 'vector', title: 'STL vector & sorting', lessonId: 'cpp-vector',
    description: 'Dynamic contiguous storage. push_back is amortized O(1); sort is O(n log n). Use at() for checked access.',
    methods: 'std::vector · push_back · size · at · begin/end · std::sort' },
  { file: 'list', title: 'STL linked list', lessonId: 'cpp-list',
    description: 'Doubly linked sequence. Insertion/erasure at a known position is O(1); finding that position is O(n).',
    methods: 'std::list · push_front · push_back · front · pop_front · erase · empty' },
  { file: 'queue', title: 'STL queue', lessonId: 'cpp-queue',
    description: 'FIFO adaptor. Push, front and pop are O(1). Check empty() before front() or pop(); pop() returns no value.',
    methods: 'std::queue · push · front · back · pop · size · empty' },
  { file: 'stack', title: 'STL stack', lessonId: 'cpp-stack',
    description: 'LIFO adaptor. Push, top and pop are O(1). Check empty() before top() or pop(); pop() returns no value.',
    methods: 'std::stack · push · top · pop · size · empty' },
  { file: 'algorithm', title: 'STL binary search', lessonId: 'cpp-search',
    description: 'Requires a sorted range. Vector searches take O(log n) comparisons; lower/upper_bound return iterators, not indexes.',
    methods: 'std::binary_search · std::lower_bound · std::upper_bound' },
];
