export const lessons = [
  {
    id: 'sum',
    expectedStatus: 'success', expectedStdout: '3 + 5 = 8\n',
    title: 'Input & output',
    description: 'Two numbers, one small program. Try removing a semicolon to see a compiler diagnostic on the board.',
    stdin: '3 5\n',
    source: '#include <stdio.h>\n\nint main(void) {\n    int a, b;\n    if (scanf("%d %d", &a, &b) != 2) {\n        puts("Please supply two integers.");\n        return 1;\n    }\n    printf("%d + %d = %d\\n", a, b, a + b);\n    return 0;\n}',
  },
  {
    id: 'memory',
    expectedStatus: 'runtime_error',
    title: 'A memory mistake',
    description: 'What happens after free()? Run this lesson, then move free(values) below the printf and try again.',
    stdin: '',
    source: '#include <stdio.h>\n#include <stdlib.h>\n\nint main(void) {\n    setvbuf(stdout, NULL, _IONBF, 0);\n    int *values = malloc(3 * sizeof *values);\n    if (!values) return 1;\n    values[0] = 42;\n    printf("Pointer on stack: %p\\n", (void *)&values);\n    printf("Buffer address: %p\\n", (void *)values);\n    free(values);\n    printf("First value: %d\\n", values[0]);\n    return 0;\n}',
  },
  {
    id: 'stack',
    expectedStatus: 'runtime_error',
    title: 'Under the abstraction',
    description: 'An empty stack has a contract. Add stack_push(&s, 42) before stack_pop to satisfy it.',
    stdin: '',
    source: '#include <stdio.h>\n#include <stack.h>\n\nint main(void) {\n    Stack s;\n    stack_init(&s);\n    int value = stack_pop(&s);\n    printf("Popped: %d\\n", value);\n    stack_free(&s);\n    return 0;\n}',
  },
  {
    id: 'linked-list', title: 'Follow the links', expectedStatus: 'success', expectedStdout: '10 20 30\nFound: 20\n',
    description: 'Build a linked list, insert at an index, and traverse its nodes. Try erasing an invalid index.', stdin: '',
    source: '#include <stdio.h>\n#include <linked_list.h>\n\nint main(void) {\n    LinkedList list;\n    list_init(&list);\n    list_push_back(&list, 10);\n    list_push_back(&list, 30);\n    list_insert(&list, 1, 20);\n    for (const ListNode *node = list.head; node; node = node->next) {\n        printf("%d%s", node->value, node->next ? " " : "\\n");\n    }\n    const ListNode *found = list_find(&list, 20);\n    if (found) printf("Found: %d\\n", found->value);\n    list_free(&list);\n    return 0;\n}',
  },
  {
    id: 'queue', title: 'First in, first out', expectedStatus: 'success', expectedStdout: '10 20 30\n',
    description: 'Push values into a growing circular queue, then remove them in FIFO order.', stdin: '',
    source: '#include <stdio.h>\n#include <queue.h>\n\nint main(void) {\n    Queue q;\n    queue_init(&q);\n    queue_push(&q, 10);\n    queue_push(&q, 20);\n    queue_push(&q, 30);\n    while (!queue_empty(&q)) {\n        int value = queue_pop(&q);\n        printf("%d%s", value, queue_empty(&q) ? "\\n" : " ");\n    }\n    queue_free(&q);\n    return 0;\n}',
  },
  {
    id: 'search', title: 'Halve the search space', expectedStatus: 'success', expectedStdout: 'First 4: 2\nEqual range: [2, 5)\nMissing 9: -1\n',
    description: 'Find the first matching value and the bounds of duplicates in an ascending sorted array.', stdin: '',
    source: '#include <stdio.h>\n#include <search.h>\n\nint main(void) {\n    int values[] = {1, 2, 4, 4, 4, 7};\n    size_t count = sizeof values / sizeof values[0];\n    printf("First 4: %td\\n", binary_search(values, count, 4));\n    printf("Equal range: [%zu, %zu)\\n",\n        lower_bound(values, count, 4), upper_bound(values, count, 4));\n    printf("Missing 9: %td\\n", binary_search(values, count, 9));\n    return 0;\n}',
  },
];
