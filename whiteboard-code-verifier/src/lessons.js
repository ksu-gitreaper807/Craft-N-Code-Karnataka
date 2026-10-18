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
    source: '#include <stdio.h>\n#include <stdlib.h>\n\nint main(void) {\n    setvbuf(stdout, NULL, _IONBF, 0);\n    int *values = (int *)malloc(3 * sizeof *values);\n    if (!values) return 1;\n    values[0] = 42;\n    printf("Pointer on stack: %p\\n", (void *)&values);\n    printf("Buffer address: %p\\n", (void *)values);\n    free(values);\n    printf("First value: %d\\n", values[0]);\n    return 0;\n}',
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
    id: 'linked-list', title: 'Follow the links', expectedStatus: 'success', expectedStdout: '1->3->4->5\n',
    description: 'Turn an arrow drawing into real linked nodes. Change the values or traverse and modify the list.', stdin: '',
    source: '#include <stdio.h>\n#include <linked_list.h>\n\nint main(void) {\n    LinkedList list;\n    list_init(&list);\n    if (!list_from_arrows(&list, "1->3->4->5")) return 1;\n    for (const ListNode *node = list.head; node; node = node->next) {\n        printf("%d%s", node->value, node->next ? "->" : "\\n");\n    }\n    list_free(&list);\n    return 0;\n}',
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

lessons.push(
  { id: 'cpp-vector', title: 'C++ vector & sorting', expectedStatus: 'success', expectedStdout: '1 2 3 4\n', stdin: '',
    description: 'Grow a vector, sort it, and traverse its values.',
    source: '#include <iostream>\n#include <vector>\n#include <algorithm>\n\nint main() {\n    std::vector<int> values{3, 1, 2};\n    values.push_back(4);\n    std::sort(values.begin(), values.end());\n    for (std::size_t i = 0; i < values.size(); ++i)\n        std::cout << values[i] << (i + 1 == values.size() ? "\\n" : " ");\n}' },
  { id: 'cpp-list', title: 'C++ linked list', expectedStatus: 'success', expectedStdout: '10 20 30\n', stdin: '',
    description: 'Use std::list for a doubly linked sequence with automatic cleanup.',
    source: '#include <iostream>\n#include <list>\n\nint main() {\n    std::list<int> values{20};\n    values.push_front(10);\n    values.push_back(30);\n    while (!values.empty()) {\n        std::cout << values.front();\n        values.pop_front();\n        std::cout << (values.empty() ? "\\n" : " ");\n    }\n}' },
  { id: 'cpp-queue', title: 'C++ queue', expectedStatus: 'success', expectedStdout: '10 20 30\n', stdin: '',
    description: 'std::queue removes values in first-in, first-out order.',
    source: '#include <iostream>\n#include <queue>\n\nint main() {\n    std::queue<int> values;\n    for (int value : {10, 20, 30}) values.push(value);\n    while (!values.empty()) {\n        std::cout << values.front();\n        values.pop();\n        std::cout << (values.empty() ? "\\n" : " ");\n    }\n}' },
  { id: 'cpp-stack', title: 'C++ stack', expectedStatus: 'success', expectedStdout: '30 20 10\n', stdin: '',
    description: 'std::stack removes values in last-in, first-out order.',
    source: '#include <iostream>\n#include <stack>\n\nint main() {\n    std::stack<int> values;\n    for (int value : {10, 20, 30}) values.push(value);\n    while (!values.empty()) {\n        std::cout << values.top();\n        values.pop();\n        std::cout << (values.empty() ? "\\n" : " ");\n    }\n}' },
  { id: 'cpp-search', title: 'C++ binary search', expectedStatus: 'success', expectedStdout: 'Found: 1\nRange: 2 5\n', stdin: '',
    description: 'Search a sorted vector and locate the bounds of duplicate values.',
    source: '#include <iostream>\n#include <vector>\n#include <algorithm>\n\nint main() {\n    std::vector<int> values{1, 2, 4, 4, 4, 7};\n    auto first = std::lower_bound(values.begin(), values.end(), 4);\n    auto last = std::upper_bound(values.begin(), values.end(), 4);\n    std::cout << "Found: " << std::binary_search(values.begin(), values.end(), 4) << "\\n";\n    std::cout << "Range: " << first - values.begin() << " " << last - values.begin() << "\\n";\n}' },
);
